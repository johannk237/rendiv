import path from 'node:path';

/**
 * Generates the JavaScript code for the render entry point.
 * This code is injected into the bundle and bridges the headless browser
 * with the Rendiv renderer via window globals.
 */
export function generateRenderEntryCode(
  userEntryPoint: string,
  overrides?: Record<string, unknown>,
): string {
  // Normalize Windows separators while preserving literal backslashes in POSIX
  // filenames. Serialize the specifier to keep special characters valid in JS.
  const isWindowsPath = path.win32.isAbsolute(userEntryPoint)
    && (process.platform === 'win32' || !path.posix.isAbsolute(userEntryPoint));
  const importPath = JSON.stringify(isWindowsPath
    ? userEntryPoint.replace(/\\/g, '/')
    : userEntryPoint);

  // Serialize overrides so Sequence components can read them at runtime
  const overridesSnippet = overrides && Object.keys(overrides).length > 0
    ? `window.__RENDIV_TIMELINE_OVERRIDES__ = new Map(Object.entries(${JSON.stringify(overrides)}));`
    : '';

  return `
import ${importPath};
import { getRootComponent, CompositionManagerContext, TimelineContext, CompositionContext, RendivEnvironmentContext, getPendingHoldCount, getPendingHoldLabels } from '@rendiv/core';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

// Timeline overrides (embedded from timeline-overrides.json at bundle time)
${overridesSnippet}

// Composition registry
const compositions = [];

function registerComposition(comp) {
  const existing = compositions.findIndex(c => c.id === comp.id);
  if (existing >= 0) compositions[existing] = comp;
  else compositions.push(comp);
}

function unregisterComposition(id) {
  const idx = compositions.findIndex(c => c.id === id);
  if (idx >= 0) compositions.splice(idx, 1);
}

// Expose to renderer
window.__RENDIV_GET_COMPOSITIONS__ = () => {
  return compositions.map(c => ({
    id: c.id,
    durationInFrames: c.durationInFrames,
    fps: c.fps,
    width: c.width,
    height: c.height,
    defaultProps: c.defaultProps,
    type: c.type,
  }));
};

window.__RENDIV_PENDING_HOLDS__ = () => getPendingHoldCount();
window.__RENDIV_PENDING_HOLD_LABELS__ = () => getPendingHoldLabels();

// getRendivEnvironment() (the non-hook variant) reads this global
window.__RENDIV_ENVIRONMENT__ = 'rendering';

// The first error that stops the page (a component that throws, a failed media load): the renderer checks it after
// every frame and fails the render instead of capturing a broken picture.
window.__RENDIV_FATAL_ERROR__ = null;
function reportFatal(error) {
  if (window.__RENDIV_FATAL_ERROR__) return;
  const e = error instanceof Error ? error : new Error(String(error));
  window.__RENDIV_FATAL_ERROR__ = { message: e.message, stack: e.stack || '' };
}
window.addEventListener('error', (event) => reportFatal(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportFatal(event.reason));

// Metadata computed from the props (resolveConfig), per composition id
const resolved = new Map();

async function resolveComposition(id, props) {
  const comp = compositions.find(c => c.id === id);
  if (!comp) {
    const available = compositions.map(c => c.id).join(', ');
    throw new Error('Composition "' + id + '" not found. Available: ' + (available || '(none)'));
  }
  const mergedProps = { ...comp.defaultProps, ...props };
  let metadata = {};
  if (comp.resolveConfig) {
    metadata = (await comp.resolveConfig({
      defaultProps: comp.defaultProps,
      props: mergedProps,
      abortSignal: new AbortController().signal,
      compositionId: id,
    })) || {};
  }
  const result = {
    id: comp.id,
    width: metadata.width ?? comp.width,
    height: metadata.height ?? comp.height,
    fps: metadata.fps ?? comp.fps,
    durationInFrames: metadata.durationInFrames ?? comp.durationInFrames,
    defaultProps: comp.defaultProps,
    props: metadata.props ?? mergedProps,
    type: comp.type,
  };
  resolved.set(id, result);
  return result;
}

window.__RENDIV_RESOLVE_COMPOSITION__ = (id, props) => resolveComposition(id, props ?? inputProps);

// State management
let currentFrame = 0;
let currentCompositionId = null;
let inputProps = {};
let rootInstance = null;
let resolveFrameReady = null;

window.__RENDIV_SET_FRAME__ = (frame) => {
  const t0 = performance.now();
  currentFrame = frame;
  rerender();
  window.__RENDIV_RENDER_MS__ = performance.now() - t0;
  return new Promise((resolve) => {
    resolveFrameReady = resolve;
    // Check immediately if already ready
    checkReady();
  });
};

window.__RENDIV_SET_COMPOSITION__ = async (id) => {
  await resolveComposition(id, inputProps);
  currentCompositionId = id;
  rerender();
};

window.__RENDIV_SET_INPUT_PROPS__ = (props) => {
  inputProps = props;
  window.__RENDIV_INPUT_PROPS__ = props;
  rerender();
};

function checkReady() {
  if (resolveFrameReady && (getPendingHoldCount() === 0 || window.__RENDIV_FATAL_ERROR__)) {
    const resolve = resolveFrameReady;
    resolveFrameReady = null;
    resolve();
  }
}

// Poll for pending holds (4ms for faster hold detection)
setInterval(checkReady, 4);

function App() {
  const Root = getRootComponent();
  if (!Root) return null;

  const comp = compositions.find(c => c.id === currentCompositionId);

  const managerValue = useMemo(() => ({
    compositions,
    registerComposition,
    unregisterComposition,
    currentCompositionId,
    setCurrentCompositionId: (id) => { currentCompositionId = id; },
    inputProps,
  }), []);

  // Registration phase: render Root to collect compositions
  if (!currentCompositionId) {
    return React.createElement(
      CompositionManagerContext.Provider,
      { value: managerValue },
      React.createElement(Root)
    );
  }

  // Rendering phase: render the selected composition
  if (!comp) return null;

  const Component = comp.component;
  const meta = resolved.get(comp.id);
  const mergedProps = meta ? meta.props : { ...comp.defaultProps, ...inputProps };

  const compositionConfig = {
    id: comp.id,
    width: meta ? meta.width : comp.width,
    height: meta ? meta.height : comp.height,
    fps: meta ? meta.fps : comp.fps,
    durationInFrames: meta ? meta.durationInFrames : comp.durationInFrames,
    defaultProps: mergedProps,
  };

  const timelineValue = {
    frame: currentFrame,
    playing: false,
    playingRef: { current: false },
  };

  const envValue = { environment: 'rendering' };

  return React.createElement(
    CompositionManagerContext.Provider,
    { value: managerValue },
    React.createElement(
      RendivEnvironmentContext.Provider,
      { value: envValue },
      React.createElement(
        CompositionContext.Provider,
        { value: compositionConfig },
        React.createElement(
          TimelineContext.Provider,
          { value: timelineValue },
          React.createElement(Root),
          React.createElement(Component, mergedProps)
        )
      )
    )
  );
}

const container = document.getElementById('root');
rootInstance = createRoot(container, {
  // React 19: errors no boundary caught. (React 18 rethrows them, and the window listener above sees them.)
  onUncaughtError: (error) => reportFatal(error),
});

function rerender() {
  flushSync(() => {
    rootInstance.render(React.createElement(App));
  });
}

rerender();

// Signal that the entry has loaded
window.__RENDIV_LOADED__ = true;
`;
}
