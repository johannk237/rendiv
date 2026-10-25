import { openBrowser, openPage, type OpenBrowserOptions } from './browser.js';
import { startServer } from './serve.js';
import { openCompositionPage, resolveComposition } from './composition-page.js';
import type { CompositionInfo } from './types.js';

export async function getCompositions(serveUrl: string): Promise<CompositionInfo[]> {
  const server = await startServer(serveUrl);

  try {
    const browser = await openBrowser();
    const page = await openPage(browser, server.url, {
      width: 1920,
      height: 1080,
    });

    // Capture console errors for debugging
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    // Wait for the entry to load
    try {
      await page.waitForFunction(() => (window as any).__RENDIV_LOADED__ === true, {
        timeout: 30000,
      });
    } catch (e) {
      const errorDetails = errors.length > 0
        ? `\nBrowser errors:\n${errors.join('\n')}`
        : '\nNo browser errors captured.';
      throw new Error(`Timed out waiting for Rendiv bundle to load.${errorDetails}`);
    }

    // Small delay to ensure compositions are registered
    await page.waitForTimeout(100);

    const compositions = await page.evaluate(() => {
      return (window as any).__RENDIV_GET_COMPOSITIONS__();
    });

    await page.close();
    return compositions;
  } finally {
    server.close();
  }
}

/**
 * The composition `id`, with the metadata its resolveConfig computes from these props (duration, size, fps).
 * Pass the result to renderMedia / renderStill.
 */
export async function selectComposition(
  serveUrl: string,
  id: string,
  inputProps: Record<string, unknown> = {},
  options: OpenBrowserOptions = {},
): Promise<CompositionInfo> {
  const server = await startServer(serveUrl);
  try {
    const browser = await openBrowser(options);
    const target = await openCompositionPage({ browser, url: server.url, width: 1920, height: 1080 });
    try {
      const info = await resolveComposition(target, id, inputProps);
      return { ...info, defaultProps: { ...info.defaultProps, ...inputProps } };
    } finally {
      await target.page.context().close();
    }
  } finally {
    server.close();
  }
}
