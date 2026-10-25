import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, type OpenBrowserOptions } from './browser.js';
import { mountComposition, openCompositionPage, showFrame } from './composition-page.js';
import { startServer } from './serve.js';
import type { CompositionInfo } from './types.js';

export interface RenderStillOptions {
  serveUrl: string;
  composition: CompositionInfo;
  output: string;
  frame?: number;
  inputProps?: Record<string, unknown>;
  imageFormat?: 'png' | 'jpeg';
  quality?: number;
  timeoutPerFrame?: number;
  gl?: OpenBrowserOptions['gl'];
  /** Device pixel ratio of the image: 0.5 halves the width and height. Default: 1 */
  scale?: number;
}

export async function renderStill(options: RenderStillOptions): Promise<void> {
  const {
    serveUrl,
    composition,
    output,
    frame = 0,
    inputProps = {},
    imageFormat = 'png',
    quality,
    timeoutPerFrame = 30000,
    gl,
    scale = 1,
  } = options;

  // Ensure output directory exists
  const outputDir = path.dirname(output);
  fs.mkdirSync(outputDir, { recursive: true });

  const server = await startServer(serveUrl);

  try {
    const browser = await openBrowser({ gl });
    const target = await openCompositionPage({
      browser,
      url: server.url,
      width: composition.width,
      height: composition.height,
      scale,
    });
    const { page } = target;
    await mountComposition(target, composition.id, inputProps);
    await showFrame(target, frame, timeoutPerFrame);

    await page.screenshot({
      path: output,
      type: imageFormat,
      quality: imageFormat === 'jpeg' ? (quality ?? 80) : undefined,
    });

    await page.context().close();
  } finally {
    server.close();
  }
}
