import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useEffect,
  useState,
  useCallback,
  type CSSProperties,
  type ComponentType,
} from 'react';
import { usePlayer } from './use-player';
import { PlayerEmitter, type PlayerEventMap } from './PlayerEmitter';
import { PlayerControls } from './PlayerControls';
import {
  CompositionStage,
  fitComposition,
  hasOwnHeight,
  useElementSize,
  type ErrorFallbackProps,
} from './composition-stage';

export interface PlayerProps {
  component: ComponentType<Record<string, unknown>>;
  durationInFrames: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
  /** Composition id exposed via CompositionContext. Defaults to 'player'. */
  compositionId?: string;
  /** Without a height, the player is as tall as the composition at its width; with one, the composition fits inside. */
  style?: CSSProperties;
  className?: string;
  controls?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  initiallyMuted?: boolean;
  /** Initial volume, 0 to 1. Default: 1 */
  initialVolume?: number;
  inputProps?: Record<string, unknown>;
  playbackRate?: number;
  errorFallback?: ComponentType<ErrorFallbackProps>;
  /** Keyboard shortcuts when the player has focus (space / k play-pause, arrows step, 0 to start). Default: true */
  keyboardShortcuts?: boolean;
  /** Same as `keyboardShortcuts` (only space toggles playback). */
  spaceKeyToPlayOrPause?: boolean;
  /** A click on the video toggles playback. Default: false */
  clickToPlay?: boolean;
  /** A double click toggles fullscreen. Default: false */
  doubleClickToFullscreen?: boolean;
  /** Background around the composition when it does not fill the player. Default: #000 */
  backgroundColor?: string;
}

type Listener<T> = (data: T) => void;

export interface PlayerRef {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (frame: number) => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
  getContainerNode: () => HTMLDivElement | null;
  mute: () => void;
  unmute: () => void;
  isMuted: () => boolean;
  setVolume: (v: number) => void;
  getVolume: () => number;
  requestFullscreen: () => void;
  exitFullscreen: () => void;
  isFullscreen: () => boolean;
  /** The size the composition is drawn at, divided by its own size. */
  getScale: () => number;
  addEventListener: <K extends keyof PlayerEventMap>(
    event: K,
    callback: Listener<PlayerEventMap[K]>
  ) => void;
  removeEventListener: <K extends keyof PlayerEventMap>(
    event: K,
    callback: Listener<PlayerEventMap[K]>
  ) => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const Player = forwardRef<PlayerRef, PlayerProps>((props, ref) => {
  const {
    component,
    durationInFrames,
    fps,
    compositionWidth,
    compositionHeight,
    compositionId = 'player',
    controls = false,
    loop = false,
    autoPlay = false,
    initiallyMuted = false,
    initialVolume = 1,
    playbackRate = 1,
    inputProps: passedInputProps,
    style,
    className,
    errorFallback,
    keyboardShortcuts,
    spaceKeyToPlayOrPause,
    clickToPlay = false,
    doubleClickToFullscreen = false,
    backgroundColor = '#000',
  } = props;
  const shortcuts = keyboardShortcuts ?? spaceKeyToPlayOrPause ?? true;

  // A new {} on every render would re-render the whole composition for nothing
  const emptyProps = useMemo(() => ({}), []);
  const inputProps = passedInputProps ?? emptyProps;

  const containerRef = useRef<HTMLDivElement>(null);
  const emitter = useMemo(() => new PlayerEmitter(), []);
  const containerSize = useElementSize(containerRef);
  const fitHeight = hasOwnHeight(style);
  const { scale, offsetX, offsetY } = fitComposition(
    containerSize,
    { width: compositionWidth, height: compositionHeight },
    fitHeight,
  );

  const [muted, setMuted] = useState(initiallyMuted);
  const [volume, setVolumeState] = useState(clamp01(initialVolume));
  const mediaVolume = useMemo(() => ({ muted, volume }), [muted, volume]);

  const player = usePlayer({
    fps,
    durationInFrames,
    loop,
    playbackRate,
    autoPlay,
  });

  // Emit events
  useEffect(() => {
    emitter.emit('frameupdate', { frame: player.frame });
  }, [player.frame, emitter]);

  // play / pause on changes only (not on mount), ended when playback stops on the last frame
  const wasPlayingRef = useRef(player.playing);
  useEffect(() => {
    if (wasPlayingRef.current === player.playing) return;
    wasPlayingRef.current = player.playing;
    if (player.playing) {
      emitter.emit('play');
    } else {
      emitter.emit('pause');
      if (!loop && player.frame >= durationInFrames - 1) emitter.emit('ended');
    }
  }, [player.playing, player.frame, durationInFrames, loop, emitter]);

  const isFirstMuteRef = useRef(true);
  useEffect(() => {
    if (isFirstMuteRef.current) {
      isFirstMuteRef.current = false;
      return;
    }
    emitter.emit('mutechange', { isMuted: muted });
  }, [muted, emitter]);

  useEffect(() => {
    const onChange = () => emitter.emit('fullscreenchange', { isFullscreen: document.fullscreenElement === containerRef.current });
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [emitter]);

  const frameRef = useRef(player.frame);
  frameRef.current = player.frame;

  const playingRef = useRef(player.playing);
  playingRef.current = player.playing;

  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const seekTo = useCallback(
    (frame: number) => {
      const clamped = Math.max(0, Math.min(Math.round(frame), durationInFrames - 1));
      player.seekTo(clamped);
      frameRef.current = clamped;
      emitter.emit('seeked', { frame: clamped });
    },
    [player, durationInFrames, emitter],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current?.requestFullscreen().catch(() => {});
  }, []);

  useImperativeHandle(ref, () => ({
    play: player.play,
    pause: player.pause,
    toggle: player.toggle,
    seekTo,
    getCurrentFrame: () => frameRef.current,
    isPlaying: () => playingRef.current,
    getContainerNode: () => containerRef.current,
    mute: () => setMuted(true),
    unmute: () => setMuted(false),
    isMuted: () => mutedRef.current,
    setVolume: (v: number) => {
      const next = clamp01(v);
      volumeRef.current = next;
      setVolumeState(next);
      emitter.emit('volumechange', { volume: next });
    },
    getVolume: () => volumeRef.current,
    requestFullscreen: () => {
      containerRef.current?.requestFullscreen().catch(() => {});
    },
    exitFullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    },
    isFullscreen: () => typeof document !== 'undefined' && document.fullscreenElement === containerRef.current,
    getScale: () => scaleRef.current,
    addEventListener: emitter.addEventListener.bind(emitter),
    removeEventListener: emitter.removeEventListener.bind(emitter),
  }), [player.play, player.pause, player.toggle, seekTo, emitter]);

  // Keyboard controls
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!shortcuts) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        player.toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(player.frame - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(player.frame + 1);
      } else if (e.key === '0') {
        e.preventDefault();
        seekTo(0);
      }
    },
    [player, seekTo, shortcuts]
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        ...(fitHeight ? {} : { height: compositionHeight * scale }),
        backgroundColor,
        ...style,
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={clickToPlay ? () => player.toggle() : undefined}
      onDoubleClick={doubleClickToFullscreen ? toggleFullscreen : undefined}
    >
      <CompositionStage
        component={component}
        inputProps={inputProps}
        compositionId={compositionId}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        fps={fps}
        durationInFrames={durationInFrames}
        frame={player.frame}
        playing={player.playing}
        mediaVolume={mediaVolume}
        scale={scale}
        offsetX={offsetX}
        offsetY={offsetY}
        errorFallback={errorFallback}
      />
      {controls && (
        <PlayerControls
          player={{ ...player, seekTo }}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      )}
    </div>
  );
});

Player.displayName = 'Player';
