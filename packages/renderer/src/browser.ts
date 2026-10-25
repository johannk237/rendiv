import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium, type Browser, type Page } from 'playwright';

/** 'default': no OpenGL flag, Chrome chooses (software compositing without a GPU, the fastest for 2D). */
export type GlRenderer = 'swiftshader' | 'egl' | 'angle' | 'default';

export interface OpenBrowserOptions {
  gl?: GlRenderer;
  /** A Chrome / Chromium to use instead of Playwright's. Default: the RENDIV_BROWSER_EXECUTABLE variable, if set. */
  executablePath?: string;
}

let browserInstance: Browser | null = null;
let currentGl: GlRenderer = 'swiftshader';

function glArgs(gl: GlRenderer): string[] {
  switch (gl) {
    case 'egl':
      return ['--use-gl=egl'];
    case 'angle':
      return ['--use-gl=angle'];
    case 'default':
      return [];
    case 'swiftshader':
    default:
      return ['--use-gl=angle', '--use-angle=swiftshader'];
  }
}

export async function openBrowser(options?: OpenBrowserOptions): Promise<Browser> {
  const gl = options?.gl ?? 'swiftshader';

  if (browserInstance && browserInstance.isConnected() && gl !== currentGl) {
    await browserInstance.close();
    browserInstance = null;
  }

  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  currentGl = gl;
  const executablePath = options?.executablePath ?? process.env.RENDIV_BROWSER_EXECUTABLE ?? undefined;
  browserInstance = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials',
      '--no-sandbox',
      '--force-color-profile=srgb',
      // Every page renders at full speed, even the ones not in front
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--intensive-wake-up-throttling-policy=0',
      // /dev/shm is tiny in Docker containers
      '--disable-dev-shm-usage',
      // Glyphs drawn the same on every machine
      '--font-render-hinting=none',
      '--hide-scrollbars',
      '--mute-audio',
      ...glArgs(gl),
    ],
  });
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Opens the browser, installing Playwright's headless Chromium first when it is missing (first run on a machine).
 * The installer's output goes to stderr: stdout stays free for the caller's own protocol.
 */
export async function ensureBrowser(options?: OpenBrowserOptions): Promise<Browser> {
  try {
    return await openBrowser(options);
  } catch (e) {
    if (options?.executablePath || process.env.RENDIV_BROWSER_EXECUTABLE || !/Executable doesn't exist/i.test(String(e))) throw e;
  }
  // cli.js is the package's bin, next to its package.json (not in its exports map)
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'install', '--only-shell', 'chromium'], { stdio: ['ignore', process.stderr, process.stderr] });
  if (result.status !== 0) throw new Error('Could not install Chromium for Playwright (npx playwright install --only-shell chromium).');
  return openBrowser(options);
}

export async function openPage(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  scale = 1,
): Promise<Page> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}
