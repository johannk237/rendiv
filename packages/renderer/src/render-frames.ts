import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openBrowser, type OpenBrowserOptions } from './browser.js';
import { mountComposition, openCompositionPage, showFrame, type CompositionPage } from './composition-page.js';
import { startServer } from './serve.js';
import type { AudioSourceInfo, CompositionInfo } from './types.js';

export type ImageFormat = 'png' | 'jpeg';

export interface FrameTimings {
  setFrameMs: number;
  waitForHoldsMs: number;
  screenshotMs: number;
  totalMs: number;
}

export interface RenderProfile {
  totalFrames: number;
  totalTimeMs: number;
  avgFrameTimeMs: number;
  phases: {
    setFrame: { avgMs: number; maxMs: number; totalMs: number };
    waitForHolds: { avgMs: number; maxMs: number; totalMs: number };
    screenshot: { avgMs: number; maxMs: number; totalMs: number };
  };
  bottleneck: 'setFrame' | 'waitForHolds' | 'screenshot';
  framesPerSecond: number;
}

export interface RenderFramesOptions {
  serveUrl: string;
  composition: CompositionInfo;
  outputDir: string;
  inputProps?: Record<string, unknown>;
  concurrency?: number;
  frameRange?: [number, number];
  onFrameRendered?: (info: { frame: number; total: number; timings?: FrameTimings }) => void;
  cancelSignal?: AbortSignal;
  timeoutPerFrame?: number;
  imageFormat?: ImageFormat;
  /** JPEG quality (1–100). Higher values reduce compression artifacts like gradient banding. Default: 80 */
  jpegQuality?: number;
  gl?: OpenBrowserOptions['gl'];
  profiling?: boolean;
  /** Device pixel ratio of the frames: 2 doubles the width and height. Default: 1 */
  scale?: number;
}

async function renderSingleFrame(
  target: CompositionPage,
  frame: number,
  outputDir: string,
  timeoutPerFrame: number,
  imageFormat: ImageFormat,
  jpegQuality: number,
  profiling: boolean,
): Promise<FrameTimings | null> {
  const { page } = target;
  const t0 = profiling ? performance.now() : 0;

  // Set the frame and wait for it to be ready: React rendering, then every
  // pending hold (e.g. OffthreadVideo extraction). Fails on a page error.
  await showFrame(target, frame, timeoutPerFrame);

  const t1 = profiling ? performance.now() : 0;

  // Read the browser-side measurement of just the React flushSync time,
  // to separate it from hold waiting.
  const browserRenderMs = profiling
    ? await page.evaluate(() => (window as any).__RENDIV_RENDER_MS__ ?? 0) as number
    : 0;

  const t2 = t1;

  // Screenshot
  const paddedFrame = String(frame).padStart(6, '0');
  const ext = imageFormat === 'jpeg' ? 'jpeg' : 'png';
  await page.screenshot({
    path: path.join(outputDir, `frame-${paddedFrame}.${ext}`),
    type: imageFormat,
    ...(imageFormat === 'jpeg' ? { quality: jpegQuality } : {}),
  });

  const t3 = profiling ? performance.now() : 0;

  if (!profiling) return null;

  return {
    setFrameMs: browserRenderMs,
    waitForHoldsMs: Math.max(0, (t1 - t0) - browserRenderMs),
    screenshotMs: t3 - t2,
    totalMs: t3 - t0,
  };
}

function computeProfile(allTimings: FrameTimings[], totalRenderTimeMs: number): RenderProfile {
  const n = allTimings.length;

  const sum = { setFrame: 0, waitForHolds: 0, screenshot: 0 };
  const max = { setFrame: 0, waitForHolds: 0, screenshot: 0 };

  for (const t of allTimings) {
    sum.setFrame += t.setFrameMs;
    sum.waitForHolds += t.waitForHoldsMs;
    sum.screenshot += t.screenshotMs;
    if (t.setFrameMs > max.setFrame) max.setFrame = t.setFrameMs;
    if (t.waitForHoldsMs > max.waitForHolds) max.waitForHolds = t.waitForHoldsMs;
    if (t.screenshotMs > max.screenshot) max.screenshot = t.screenshotMs;
  }

  const avgTotal = allTimings.reduce((s, t) => s + t.totalMs, 0) / n;

  const phases = {
    setFrame: { avgMs: sum.setFrame / n, maxMs: max.setFrame, totalMs: sum.setFrame },
    waitForHolds: { avgMs: sum.waitForHolds / n, maxMs: max.waitForHolds, totalMs: sum.waitForHolds },
    screenshot: { avgMs: sum.screenshot / n, maxMs: max.screenshot, totalMs: sum.screenshot },
  };

  let bottleneck: RenderProfile['bottleneck'] = 'setFrame';
  if (phases.waitForHolds.totalMs > phases[bottleneck].totalMs) bottleneck = 'waitForHolds';
  if (phases.screenshot.totalMs > phases[bottleneck].totalMs) bottleneck = 'screenshot';

  return {
    totalFrames: n,
    totalTimeMs: totalRenderTimeMs,
    avgFrameTimeMs: avgTotal,
    phases,
    bottleneck,
    framesPerSecond: n / (totalRenderTimeMs / 1000),
  };
}

export interface RenderFramesResult {
  audioSources: AudioSourceInfo[];
  /** Origin the bundle was served from: audio URLs on it point to files of the bundle. */
  origin: string;
  profile?: RenderProfile;
}

export async function renderFrames(options: RenderFramesOptions): Promise<RenderFramesResult> {
  const {
    serveUrl,
    composition,
    outputDir,
    inputProps = {},
    concurrency = 1,
    frameRange,
    onFrameRendered,
    cancelSignal,
    timeoutPerFrame = 30000,
    imageFormat = 'png',
    jpegQuality = 80,
    gl,
    profiling = false,
    scale = 1,
  } = options;

  const [startFrame, endFrame] = frameRange ?? [0, composition.durationInFrames - 1];
  const totalFrames = endFrame - startFrame + 1;

  fs.mkdirSync(outputDir, { recursive: true });

  const server = await startServer(serveUrl);

  try {
    const browser = await openBrowser({ gl });
    // Create page pool
    const pages: CompositionPage[] = [];
    for (let i = 0; i < concurrency; i++) {
      const page = await openCompositionPage({
        browser,
        url: server.url,
        width: composition.width,
        height: composition.height,
        scale,
      });
      pages.push(page);
      // Set composition, input props, and image format for OffthreadVideo
      await mountComposition(page, composition.id, inputProps, imageFormat);
    }

    // Render frames using a simple pool
    const frameQueue = Array.from({ length: totalFrames }, (_, i) => startFrame + i);
    let completedFrames = 0;
    const allTimings: FrameTimings[] = [];
    const renderStartTime = profiling ? performance.now() : 0;

    const renderNext = async (page: CompositionPage): Promise<void> => {
      while (frameQueue.length > 0) {
        if (cancelSignal?.aborted || failed) return;

        const frame = frameQueue.shift()!;
        const timings = await renderSingleFrame(page, frame, outputDir, timeoutPerFrame, imageFormat, jpegQuality, profiling);

        if (timings) {
          allTimings.push(timings);
        }

        completedFrames++;
        onFrameRendered?.({ frame: completedFrames, total: totalFrames, timings: timings ?? undefined });
      }
    };

    // The first page that fails stops the others
    let failed = false;
    await Promise.all(pages.map((page) => renderNext(page).catch((e) => {
      failed = true;
      throw e;
    })));

    const renderEndTime = profiling ? performance.now() : 0;

    // Collect audio source metadata registered by Audio/Video components.
    // Each page keeps the entries of the frames it rendered: merge them all
    // (a sound heard only in another page's frames must not be lost).
    const audioByKey = new Map<string, AudioSourceInfo>();
    for (const { page } of pages) {
      const entries = await page.evaluate(() => {
        const map = (window as any).__RENDIV_AUDIO_SOURCES__ as Map<string, unknown> | undefined;
        return map ? Array.from(map.entries()) : [];
      }) as Array<[string, AudioSourceInfo]>;
      for (const [key, source] of entries) audioByKey.set(key, source);
    }
    const audioSources = Array.from(audioByKey.values());

    // Cleanup pages
    for (const { page } of pages) {
      await page.context().close();
    }

    const profile = profiling && allTimings.length > 0
      ? computeProfile(allTimings, renderEndTime - renderStartTime)
      : undefined;

    return { audioSources, profile, origin: server.url };
  } finally {
    server.close();
  }
}
