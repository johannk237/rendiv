import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import ffmpegStatic from 'ffmpeg-static';

import type { AudioSourceInfo } from './types.js';

const ffmpegPath: string = ffmpegStatic as unknown as string;

/** Every audio source is converted to this before mixing: the soundtrack is 48 kHz stereo, whatever its sources. */
const MIX_RATE = 48000;

/** What ffmpeg says about an input: audio stream and duration. */
function probe(input: string): { hasAudio: boolean; durationSec: number | null } {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', input], {
    encoding: 'utf-8',
    timeout: 15000,
  });
  const output = result.stderr || '';
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  return {
    hasAudio: /Stream #\d+:\d+.*Audio:/.test(output),
    durationSec: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
  };
}

/**
 * Where ffmpeg reads an audio source from: a file of the bundle for a path (or for a URL of the render server, which
 * is closed by now), the URL itself for any other http(s) address. null for what it cannot read (data:, blob:).
 */
function resolveAudioInput(src: string, assetsDir: string | undefined, assetsOrigin: string | undefined): string | null {
  let pathname: string | null = null;
  if (/^https?:\/\//i.test(src)) {
    const url = new URL(src);
    if (!assetsOrigin || url.origin !== new URL(assetsOrigin).origin) return src;
    pathname = decodeURIComponent(url.pathname);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return null;
  } else {
    pathname = src.split(/[?#]/)[0];
  }
  if (!assetsDir) return null;
  const cleaned = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return path.resolve(assetsDir, cleaned);
}

/** Escapes a value for an ffmpeg filtergraph option. */
const filterValue = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "'\\\\''")}'`;

export interface StitchOptions {
  framesDir: string;
  outputPath: string;
  fps: number;
  codec?: 'mp4' | 'webm';
  crf?: number;
  pixelFormat?: string;
  /** FFmpeg encoding preset (e.g. ultrafast, fast, medium, slow, veryslow). Only applies to H.264 encoders. */
  encodingPreset?: string;
  /** Video encoder override (e.g. libx264, h264_videotoolbox, h264_nvenc, libvpx-vp9). */
  videoEncoder?: string;
  /** Image format used for intermediate frames. Default: png */
  imageFormat?: 'png' | 'jpeg';
  onProgress?: (progress: number) => void;
  /** Audio sources collected from Audio/Video components */
  audioSources?: AudioSourceInfo[];
  /** Root directory where static files are served from (for resolving audio src URLs) */
  assetsDir?: string;
  /** Origin the bundle was served from while rendering: URLs on it are read from assetsDir. */
  assetsOrigin?: string;
  /** Size of the video when it differs from the frames' (they are scaled, lanczos). */
  outputSize?: { width: number; height: number };
}

export async function stitchFramesToVideo(options: StitchOptions): Promise<void> {
  const {
    framesDir,
    outputPath,
    fps,
    codec = 'mp4',
    crf = 18,
    pixelFormat = 'yuv420p',
    encodingPreset,
    videoEncoder,
    imageFormat = 'png',
    audioSources = [],
    assetsDir,
    assetsOrigin,
    outputSize,
  } = options;

  const ext = imageFormat === 'jpeg' ? 'jpeg' : 'png';
  const inputPattern = path.join(framesDir, `frame-%06d.${ext}`);

  // Resolve audio sources to files or URLs ffmpeg reads, filtering out missing ones
  const resolvedAudio: Array<AudioSourceInfo & { input: string; sourceSec: number | null }> = [];
  for (const source of audioSources) {
    const input = resolveAudioInput(source.src, assetsDir, assetsOrigin);
    if (!input) {
      console.warn(`[rendiv] Audio source cannot be read by ffmpeg, skipped: ${source.src}`);
      continue;
    }
    const isUrl = /^https?:\/\//i.test(input);
    if (!isUrl && !fs.existsSync(input)) {
      console.warn(`[rendiv] Audio source not found: ${input} (src: ${source.src})`);
      continue;
    }
    // Video-type sources may not have an audio track (e.g. screen recordings),
    // and a looping range needs the length of the file.
    const needsProbe = source.type === 'video' || isUrl || (source.loop && (source.startFrom > 0 || source.endAt !== undefined));
    const info = needsProbe ? probe(input) : { hasAudio: true, durationSec: null };
    if (!info.hasAudio) {
      if (isUrl) console.warn(`[rendiv] Audio source could not be read: ${input}`);
      continue;
    }
    resolvedAudio.push({ ...source, input, sourceSec: info.durationSec });
  }

  const args: string[] = [
    '-y',
    '-framerate', String(fps),
    '-i', inputPattern,
  ];

  // Add each audio source as an input. A loop over the whole file repeats the input itself.
  const loopsWholeFile = (audio: AudioSourceInfo) => audio.loop === true && audio.startFrom === 0 && audio.endAt === undefined;
  for (const audio of resolvedAudio) {
    if (loopsWholeFile(audio)) args.push('-stream_loop', '-1');
    args.push('-i', audio.input);
  }

  // Volume curves are applied with commands written to files (one line per change of volume)
  const commandDir = resolvedAudio.some((a) => a.volumeCurve) ? fs.mkdtempSync(path.join(os.tmpdir(), 'rendiv-volume-')) : null;

  // Build filter graph for audio processing
  let filterGraph = '';
  if (resolvedAudio.length > 0) {
    const filterParts: string[] = [];
    const mixInputs: string[] = [];

    for (let i = 0; i < resolvedAudio.length; i++) {
      const audio = resolvedAudio[i];
      const inputIdx = i + 1; // input 0 is the video frames
      const delayMs = Math.round((audio.startAtFrame / fps) * 1000);
      const startFromSec = audio.startFrom / fps;
      // Trim from the *source* file.  When playbackRate != 1 the source
      // is consumed faster/slower than real-time, so we need more/less
      // source material.  After atempo scales it, the output duration
      // will equal durationInFrames / fps (the timeline duration).
      const durationSec = (audio.durationInFrames / fps) * audio.playbackRate;
      const label = `a${i}`;

      // Build per-source filter chain: format → trim → (loop) → atempo → volume → adelay
      const filters: string[] = [`aformat=sample_fmts=fltp:sample_rates=${MIX_RATE}:channel_layouts=stereo`];

      if (audio.loop && !loopsWholeFile(audio)) {
        // Repeat the range [startFrom, endAt or end of file]
        const endSec = audio.endAt !== undefined ? audio.endAt / fps : audio.sourceSec;
        if (endSec === null || endSec <= startFromSec) {
          throw new Error(`Cannot loop ${audio.src}: its length could not be read.`);
        }
        filters.push(`atrim=start=${startFromSec.toFixed(6)}:end=${endSec.toFixed(6)}`);
        filters.push('asetpts=PTS-STARTPTS');
        filters.push(`aloop=loop=-1:size=${Math.round((endSec - startFromSec) * MIX_RATE)}`);
        filters.push(`atrim=duration=${durationSec.toFixed(6)}`);
      } else {
        // Trim: skip into source file and limit duration
        filters.push(`atrim=start=${startFromSec.toFixed(6)}:duration=${durationSec.toFixed(6)}`);
      }
      filters.push('asetpts=PTS-STARTPTS');

      // Playback rate adjustment via atempo (supports 0.5–100, chain for wider range)
      if (audio.playbackRate !== 1) {
        const tempoFilters = buildAtempoChain(audio.playbackRate);
        filters.push(...tempoFilters);
      }

      // Volume: fixed, or changed at each frame where the curve changes (time 0 = start of the placement)
      if (audio.volumeCurve && commandDir) {
        const lines: string[] = [];
        let last: number | null = null;
        audio.volumeCurve.forEach((v, frame) => {
          if (v === last) return;
          last = v;
          lines.push(`${(frame / fps).toFixed(6)} volume volume ${v.toFixed(4)};`);
        });
        const commandFile = path.join(commandDir, `${label}.cmd`);
        fs.writeFileSync(commandFile, lines.join('\n') + '\n');
        filters.push(`asendcmd=f=${filterValue(commandFile)}`);
        filters.push(`volume=${(audio.volumeCurve[0] ?? 1).toFixed(4)}:eval=frame`);
      } else if (audio.volume !== 1) {
        filters.push(`volume=${audio.volume.toFixed(4)}`);
      }

      // Delay: offset audio start position in the timeline
      if (delayMs > 0) {
        filters.push(`adelay=${delayMs}|${delayMs}`);
      }

      filterParts.push(`[${inputIdx}:a]${filters.join(',')}[${label}]`);
      mixInputs.push(`[${label}]`);
    }

    // Mix all audio tracks together, then pad with silence: the soundtrack must outlast the video, or -shortest would
    // cut the video where the last sound ends
    if (mixInputs.length === 1) {
      filterGraph = filterParts[0].slice(0, filterParts[0].lastIndexOf('[')) + ',apad[aout]';
    } else {
      filterGraph = filterParts.join(';')
        + `;${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0,apad[aout]`;
    }

    args.push('-filter_complex', filterGraph);
    args.push('-map', '0:v', '-map', '[aout]');
  }

  if (outputSize) {
    args.push('-vf', `scale=${outputSize.width}:${outputSize.height}:flags=lanczos`);
  }

  if (codec === 'mp4') {
    const encoder = videoEncoder ?? 'libx264';
    args.push('-c:v', encoder, '-crf', String(crf));
    if (encodingPreset) {
      args.push('-preset', encodingPreset);
    }
    args.push('-pix_fmt', pixelFormat, '-movflags', '+faststart');
    if (resolvedAudio.length > 0) {
      args.push('-c:a', 'aac', '-b:a', '192k');
    }
  } else {
    const encoder = videoEncoder ?? 'libvpx-vp9';
    args.push('-c:v', encoder, '-crf', String(crf), '-b:v', '0');
    if (resolvedAudio.length > 0) {
      args.push('-c:a', 'libopus', '-b:a', '128k');
    }
  }

  // The video sets the duration (the padded soundtrack never ends on its own)
  args.push('-shortest');

  args.push(outputPath);


  const cleanup = () => {
    if (commandDir) fs.rmSync(commandDir, { recursive: true, force: true });
  };

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrData = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderrData += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderrData}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  }).finally(cleanup);
}

/**
 * FFmpeg's atempo filter only supports values in [0.5, 100].
 * For rates outside this range, chain multiple atempo filters.
 */
function buildAtempoChain(rate: number): string[] {
  const filters: string[] = [];
  let remaining = rate;

  if (remaining < 0.5) {
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
  } else if (remaining > 100) {
    while (remaining > 100) {
      filters.push('atempo=100');
      remaining /= 100;
    }
  }

  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters;
}
