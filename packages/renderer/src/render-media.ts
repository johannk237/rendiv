import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { renderFrames, type RenderFramesOptions, type RenderProfile } from './render-frames.js';
import { stitchFramesToVideo } from './stitch-frames-to-video.js';
import type { CompositionInfo } from './types.js';
import type { GlRenderer } from './browser.js';

export interface RenderMediaOptions {
  composition: CompositionInfo;
  serveUrl: string;
  codec?: 'mp4' | 'webm';
  outputLocation: string;
  inputProps?: Record<string, unknown>;
  concurrency?: number;
  onProgress?: (info: {
    progress: number;
    renderedFrames: number;
    totalFrames: number;
    avgFrameTimeMs?: number;
    estimatedRemainingMs?: number;
  }) => void;
  frameRange?: [number, number];
  cancelSignal?: AbortSignal;
  /** Intermediate frame image format. Default: png */
  imageFormat?: 'png' | 'jpeg';
  /** JPEG quality (1–100). Higher values reduce compression artifacts like gradient banding. Default: 80 */
  jpegQuality?: number;
  /** FFmpeg encoding preset (ultrafast, fast, medium, slow, veryslow). */
  encodingPreset?: string;
  /** Quality factor (0–51, lower = better). Default: 18 */
  crf?: number;
  /** Video encoder override (e.g. libx264, h264_videotoolbox, h264_nvenc). */
  videoEncoder?: string;
  /** Pixel format of the MP4 (default yuv420p). yuvj420p keeps the full range of JPEG frames. */
  pixelFormat?: string;
  /** GL renderer for headless Chromium. Default: swiftshader */
  gl?: GlRenderer;
  /** Enable per-frame profiling. Default: false */
  profiling?: boolean;
  /** Device pixel ratio of the video: 2 doubles the width and height. Default: 1 */
  scale?: number;
}

/** H.264 needs even dimensions. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface RenderMediaResult {
  profile?: RenderProfile;
}

export async function renderMedia(options: RenderMediaOptions): Promise<RenderMediaResult> {
  const {
    composition,
    serveUrl,
    codec = 'mp4',
    outputLocation,
    inputProps,
    concurrency,
    onProgress,
    frameRange,
    cancelSignal,
    imageFormat,
    jpegQuality,
    encodingPreset,
    crf,
    videoEncoder,
    pixelFormat,
    gl,
    profiling = false,
    scale,
  } = options;

  const totalFrames = frameRange
    ? frameRange[1] - frameRange[0] + 1
    : composition.durationInFrames;

  const tmpDir = path.join(os.tmpdir(), `rendiv-frames-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Ensure output directory exists
  const outputDir = path.dirname(outputLocation);
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    // Running average for profiling ETA
    let totalFrameTimeMs = 0;
    let frameCount = 0;

    // Step 1: Render frames and collect audio metadata
    // Below 1, frames are captured at full size and scaled down by ffmpeg: Chromium captures a page with a device
    // scale factor under 1 several times slower than at 1.
    const captureScale = scale !== undefined && scale >= 1 ? scale : 1;
    const outputSize = scale !== undefined && scale < 1
      ? { width: even(composition.width * scale), height: even(composition.height * scale) }
      : undefined;

    const { audioSources, profile, origin } = await renderFrames({
      serveUrl,
      composition,
      outputDir: tmpDir,
      inputProps,
      concurrency,
      frameRange,
      imageFormat,
      jpegQuality,
      gl,
      profiling,
      scale: captureScale,
      onFrameRendered: ({ frame, total, timings }) => {
        let avgFrameTimeMs: number | undefined;
        let estimatedRemainingMs: number | undefined;

        if (profiling && timings) {
          totalFrameTimeMs += timings.totalMs;
          frameCount++;
          avgFrameTimeMs = totalFrameTimeMs / frameCount;
          const remainingFrames = total - frame;
          // Estimate using avg frame time divided by concurrency
          const effectiveConcurrency = concurrency ?? 1;
          estimatedRemainingMs = (remainingFrames / effectiveConcurrency) * avgFrameTimeMs;
        }

        onProgress?.({
          progress: (frame / total) * 0.9, // 90% for frame rendering
          renderedFrames: frame,
          totalFrames: total,
          avgFrameTimeMs,
          estimatedRemainingMs,
        });
      },
      cancelSignal,
    });

    if (cancelSignal?.aborted) return {};

    // Step 2: Stitch frames to video (with audio if available)
    onProgress?.({
      progress: 0.9,
      renderedFrames: totalFrames,
      totalFrames,
    });

    await stitchFramesToVideo({
      framesDir: tmpDir,
      outputPath: outputLocation,
      fps: composition.fps,
      codec,
      crf,
      encodingPreset,
      videoEncoder,
      pixelFormat,
      imageFormat,
      audioSources,
      assetsDir: serveUrl,
      assetsOrigin: origin,
      outputSize,
    });

    onProgress?.({
      progress: 1.0,
      renderedFrames: totalFrames,
      totalFrames,
    });

    return { profile };
  } finally {
    // Cleanup temp frames
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
