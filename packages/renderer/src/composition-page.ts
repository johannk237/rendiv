import type { Browser, Page } from 'playwright';
import { openPage } from './browser.js';
import type { CompositionInfo } from './types.js';

type PageError = { message: string; stack: string };

/** A page of the bundle with the errors it raised, so a render can fail instead of capturing a broken frame. */
export interface CompositionPage {
  page: Page;
  /** Throws the first error the page raised (uncaught exception, component that threw, failed media). Pass the page's
   *  fatal error when it was already read, to save a round trip. */
  throwIfFailed: (fatal?: PageError | null) => Promise<void>;
}

export interface OpenCompositionPageOptions {
  browser: Browser;
  url: string;
  width: number;
  height: number;
  /** Device pixel ratio: 2 renders a 1920×1080 composition as 3840×2160 pixels. Default: 1 */
  scale?: number;
  timeout?: number;
}

/** Opens the bundle and waits for its entry; errors raised from then on are kept for `throwIfFailed`. */
export async function openCompositionPage(options: OpenCompositionPageOptions): Promise<CompositionPage> {
  const { browser, url, width, height, scale = 1, timeout = 30000 } = options;
  const page = await openPage(browser, url, { width, height }, scale);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.stack || err.message));

  const throwIfFailed = async (known?: PageError | null) => {
    const fatal = known !== undefined ? known : await page.evaluate(() => (window as any).__RENDIV_FATAL_ERROR__ as PageError | null);
    if (fatal) throw new Error(`The composition failed while rendering: ${fatal.message}\n${fatal.stack}`);
    if (errors.length > 0) throw new Error(`The composition failed while rendering: ${errors[0]}`);
  };

  try {
    await page.waitForFunction(() => (window as any).__RENDIV_LOADED__ === true, { timeout });
  } catch {
    const details = errors.length > 0 ? `\nBrowser errors:\n${errors.join('\n')}` : '\nNo browser errors captured.';
    throw new Error(`Timed out waiting for Rendiv bundle to load.${details}`);
  }
  return { page, throwIfFailed };
}

/** Metadata of a composition once its resolveConfig has run with these props. */
export async function resolveComposition(
  page: CompositionPage,
  id: string,
  inputProps: Record<string, unknown>,
): Promise<CompositionInfo> {
  // Compositions register from an effect: give the first render a moment
  await page.page.waitForFunction(() => (window as any).__RENDIV_GET_COMPOSITIONS__().length > 0, { timeout: 10000 }).catch(() => {});
  const info = await page.page.evaluate(
    ({ id, props }) => (window as any).__RENDIV_RESOLVE_COMPOSITION__(id, props),
    { id, props: inputProps },
  ) as CompositionInfo;
  await page.throwIfFailed();
  return info;
}

/** Selects the composition to render on this page, with its input props (runs its resolveConfig). */
export async function mountComposition(
  page: CompositionPage,
  id: string,
  inputProps: Record<string, unknown>,
  imageFormat?: string,
): Promise<void> {
  await page.page.evaluate(
    async ({ id, props, imgFormat }) => {
      if (imgFormat) (window as any).__RENDIV_IMAGE_FORMAT__ = imgFormat;
      (window as any).__RENDIV_SET_INPUT_PROPS__(props);
      await (window as any).__RENDIV_SET_COMPOSITION__(id);
    },
    { id, props: inputProps, imgFormat: imageFormat },
  );
  await page.throwIfFailed();
}

/** Shows `frame` and waits until it can be captured: no pending holdRender, or an error. */
export async function showFrame(page: CompositionPage, frame: number, timeout: number): Promise<void> {
  // One round trip to the page per frame: setting the frame, waiting for the holds and reading the error all happen
  // inside it (each extra evaluate costs milliseconds per frame, more when several pages render at once)
  const outcome = await page.page.evaluate(
    async ({ f, timeout }: { f: number; timeout: number }) => {
      const w = window as any;
      await w.__RENDIV_SET_FRAME__(f);
      // Holds placed just after the frame was set (a promise, a timer) count too: let them register first
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ready = () => w.__RENDIV_PENDING_HOLDS__() === 0 || w.__RENDIV_FATAL_ERROR__;
      if (!ready()) {
        const done = await new Promise<boolean>((resolve) => {
          const started = performance.now();
          const id = setInterval(() => {
            if (ready()) {
              clearInterval(id);
              resolve(true);
            } else if (performance.now() - started > timeout) {
              clearInterval(id);
              resolve(false);
            }
          }, 4);
        });
        if (!done && !w.__RENDIV_FATAL_ERROR__) {
          return { fatal: null, timedOut: true, labels: (w.__RENDIV_PENDING_HOLD_LABELS__?.() ?? []) as string[] };
        }
      }
      return { fatal: (w.__RENDIV_FATAL_ERROR__ ?? null) as PageError | null, timedOut: false, labels: [] as string[] };
    },
    { f: frame, timeout },
  );
  await page.throwIfFailed(outcome.fatal);
  if (outcome.timedOut) {
    const { labels } = outcome;
    throw new Error(`Frame ${frame} was not ready after ${timeout} ms${labels.length ? ` (waiting for: ${labels.join(', ')})` : ''}.`);
  }
}
