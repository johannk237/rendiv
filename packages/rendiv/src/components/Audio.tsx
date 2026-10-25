import React, { useContext, useEffect, useRef, useState } from 'react';
import { TimelineContext } from '../context/TimelineContext';
import { SequenceContext } from '../context/SequenceContext';
import { CompositionContext } from '../context/CompositionContext';
import { RendivEnvironmentContext } from '../context/RendivEnvironmentContext';
import { MediaVolumeContext } from '../context/MediaVolumeContext';
import { computeLoopStartFrames } from '../compute-loop-offsets';
import { holdRender, releaseRender } from '../delay-render';

/** A fixed volume, or one per frame: the function gets the frame counted from the start of the audio. */
export type VolumeProp = number | ((frame: number) => number);

export interface AudioProps {
  src: string;
  /** Frame offset into the audio to start from. Default: 0 */
  startFrom?: number;
  /** Frame at which to stop the audio (relative to the audio timeline). */
  endAt?: number;
  /** Same as `startFrom`. */
  trimBefore?: number;
  /** Same as `endAt`. */
  trimAfter?: number;
  /** Volume from 0 to 1, fixed or per frame. Default: 1 */
  volume?: VolumeProp;
  /** Playback speed multiplier. Default: 1 */
  playbackRate?: number;
  muted?: boolean;
  /** Repeat the audio (between startFrom and endAt) for as long as it is on the timeline. */
  loop?: boolean;
  /** With `loop` and a volume function: does the frame passed to it restart at 0 on every repetition ('repeat',
   *  the default) or keep counting ('extend')? */
  loopVolumeCurveBehavior?: 'repeat' | 'extend';
}

const clampVolume = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function Audio({
  src,
  startFrom: passedStartFrom,
  endAt: passedEndAt,
  trimBefore,
  trimAfter,
  volume = 1,
  playbackRate = 1,
  muted = false,
  loop = false,
  loopVolumeCurveBehavior = 'repeat',
}: AudioProps): React.ReactElement | null {
  const startFrom = passedStartFrom ?? trimBefore ?? 0;
  const endAt = passedEndAt ?? trimAfter;
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSeekRef = useRef(0);
  const playPendingRef = useRef(false);
  const timeline = useContext(TimelineContext);
  const sequence = useContext(SequenceContext);
  const composition = useContext(CompositionContext);
  const { environment } = useContext(RendivEnvironmentContext);
  const mediaVolume = useContext(MediaVolumeContext);

  const isRendering = environment === 'rendering';
  const fps = composition?.fps ?? 30;

  // Length of the source in frames, needed to loop (in the player) and to restart a volume curve on each repetition
  // (in the render). The end of the loop is `endAt` when given, else the end of the file.
  const [sourceFrames, setSourceFrames] = useState<number | null>(null);
  const [sourceLengthUnknown, setSourceLengthUnknown] = useState(false);
  const needsSourceLength = loop && endAt === undefined
    && (!isRendering || (typeof volume === 'function' && loopVolumeCurveBehavior === 'repeat'));

  const localFrame = timeline.frame - sequence.accumulatedOffset;
  const segmentFrames = loop ? (endAt !== undefined ? endAt - startFrom : sourceFrames) : null;
  const playedFrames = localFrame * playbackRate;
  const audioFrame = segmentFrames && segmentFrames > 0
    ? startFrom + (((playedFrames % segmentFrames) + segmentFrames) % segmentFrames)
    : playedFrames + startFrom;
  const currentTime = audioFrame / fps;

  const volumeAt = (frame: number) => {
    if (typeof volume !== 'function') return volume;
    const curveFrame = loop && loopVolumeCurveBehavior === 'repeat' && segmentFrames && segmentFrames > 0
      ? frame % Math.max(1, Math.round(segmentFrames / playbackRate))
      : frame;
    return volume(curveFrame);
  };
  const effectiveVolume = clampVolume(volumeAt(Math.max(0, localFrame)) * mediaVolume.volume);
  const effectiveMuted = muted || mediaVolume.muted;

  // Read the source length when looping needs it
  useEffect(() => {
    if (!needsSourceLength || typeof window === 'undefined') return;
    const probe = document.createElement('audio');
    const handle = isRendering ? holdRender(`Reading the length of <Audio src="${src}">`, { timeoutInMilliseconds: 30000 }) : null;
    let done = false;
    const finish = (frames: number | null, unmounted = false) => {
      if (done) return;
      done = true;
      if (frames !== null) {
        setSourceFrames(frames);
      } else if (!unmounted && isRendering) {
        // The volume curve is then applied without restarting on each repetition, rather than losing the sound
        console.warn(`[rendiv] The length of <Audio src="${src}"> could not be read: its volume curve will not restart on each loop.`);
        setSourceLengthUnknown(true);
      }
      if (handle !== null) releaseRender(handle);
    };
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration * fps : null);
    probe.onerror = () => finish(null);
    probe.src = src;
    return () => finish(null, true);
  }, [needsSourceLength, src, fps, isRendering]);

  // Sync volume and muted
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = effectiveVolume;
    audio.muted = effectiveMuted;
  }, [effectiveVolume, effectiveMuted]);

  // Sync playback rate — multiply the component's own rate by the
  // accumulated Sequence playbackRate so native playback keeps pace
  // with time-stretched frames in player/studio mode.
  const effectiveRate = playbackRate * sequence.accumulatedPlaybackRate;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = effectiveRate;
  }, [effectiveRate]);

  // Sync currentTime and play/pause state
  useEffect(() => {
    if (isRendering) return;

    const audio = audioRef.current;
    if (!audio) return;

    // Past the end — pause
    if (!loop && endAt !== undefined && audioFrame >= endAt) {
      audio.pause();
      return;
    }

    if (timeline.playing) {
      if (audio.paused) {
        // Audio not yet running — seek once, then call play().
        // While play() is pending, do NOT re-seek — each seek aborts
        // the pending play request in Chrome.
        if (!playPendingRef.current) {
          audio.currentTime = currentTime;
          playPendingRef.current = true;
          audio.play().then(() => {
            playPendingRef.current = false;
          }).catch(() => {
            playPendingRef.current = false;
          });
        }
      } else {
        // Playing normally — only correct large drift.
        // Relaxed threshold + cooldown avoids rapid seeks that cause pops.
        playPendingRef.current = false;
        const drift = Math.abs(audio.currentTime - currentTime);
        if (drift > 0.3) {
          const now = performance.now();
          if (now - lastSeekRef.current > 500) {
            audio.currentTime = currentTime;
            lastSeekRef.current = now;
          }
        }
      }
    } else {
      // Paused — stop playback and seek to correct position for scrubbing
      playPendingRef.current = false;
      if (!audio.paused) audio.pause();
      if (Math.abs(audio.currentTime - currentTime) > 0.01) {
        audio.currentTime = currentTime;
      }
    }
  }, [localFrame, isRendering, currentTime, timeline.playing, endAt, audioFrame, loop]);

  // Register media info for Studio timeline visualization
  useEffect(() => {
    if (isRendering) return;
    if (typeof window === 'undefined') return;
    const seqId = sequence.id;
    if (!seqId) return;
    const w = window as unknown as Record<string, unknown>;
    if (!w.__RENDIV_MEDIA_INFO__) {
      w.__RENDIV_MEDIA_INFO__ = new Map<string, { type: string; src: string }>();
    }
    const mediaMap = w.__RENDIV_MEDIA_INFO__ as Map<string, { type: string; src: string }>;
    mediaMap.set(seqId, { type: 'audio', src });
    document.dispatchEvent(new CustomEvent('rendiv:media-sync'));
    return () => {
      mediaMap.delete(seqId);
      document.dispatchEvent(new CustomEvent('rendiv:media-sync'));
    };
  }, [src, sequence.id, isRendering]);

  // Register audio source metadata for the renderer to collect.
  // Uses a content-based key and no cleanup so entries persist across
  // the entire rendering session (Audio may unmount between frames).
  const compositionDuration = composition?.durationInFrames ?? Infinity;
  // A looping audio plays as long as its Sequence; otherwise it also stops at the end of its source range.
  const sequenceDuration = !loop && endAt !== undefined
    ? Math.min(sequence.durationInFrames, (endAt - startFrom) / playbackRate)
    : sequence.durationInFrames;
  const curveReady = typeof volume !== 'function' || !needsSourceLength || sourceFrames !== null || sourceLengthUnknown;
  const volumeKey = typeof volume === 'function' ? 'curve' : volume;
  useEffect(() => {
    if (muted || volume === 0 || !curveReady) return;
    if (typeof window === 'undefined') return;
    const w = window as unknown as Record<string, unknown>;
    if (!w.__RENDIV_AUDIO_SOURCES__) {
      w.__RENDIV_AUDIO_SOURCES__ = new Map<string, unknown>();
    }
    const sources = w.__RENDIV_AUDIO_SOURCES__ as Map<string, unknown>;
    const startFrames = computeLoopStartFrames(sequence.accumulatedOffset, sequence.loopStack, compositionDuration);
    for (const startFrame of startFrames) {
      // An Audio outside any Sequence lasts until the end of the composition
      const durationInFrames = Math.max(0, Math.min(sequenceDuration, compositionDuration - startFrame));
      if (!Number.isFinite(durationInFrames) || durationInFrames <= 0) continue;
      const key = `audio|${src}|${startFrame}|${durationInFrames}|${startFrom}|${endAt}|${loop}|${volumeKey}|${effectiveRate}`;
      // A volume curve is evaluated once per placement: the function is called for every frame of it.
      if (sources.has(key)) continue;
      const volumeCurve = typeof volume === 'function'
        ? Array.from({ length: Math.ceil(durationInFrames) }, (_, f) => clampVolume(volumeAt(f)))
        : undefined;
      sources.set(key, {
        type: 'audio' as const,
        src,
        startAtFrame: startFrame,
        durationInFrames,
        startFrom,
        volume: typeof volume === 'function' ? 1 : clampVolume(volume),
        volumeCurve,
        playbackRate: effectiveRate,
        loop,
        endAt,
      });
    }
    // No cleanup — entries persist so the renderer can collect after all frames
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, sequence.accumulatedOffset, sequence.loopStack, compositionDuration, sequenceDuration, startFrom, endAt, loop, volumeKey, effectiveRate, muted, curveReady]);

  // In rendering mode, audio is not captured via screenshots
  if (isRendering) return null;

  return (
    <audio
      ref={audioRef}
      src={src}
      preload="auto"
      loop={loop}
    />
  );
}

Audio.displayName = 'Audio';
