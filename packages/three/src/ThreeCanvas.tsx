import React, {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  TimelineContext,
  SequenceContext,
  CompositionContext,
  RendivEnvironmentContext,
  holdRender,
  releaseRender,
} from '@rendiv/core';
import { RendivContextBridge } from './RendivContextBridge';

type CanvasProps = React.ComponentProps<typeof Canvas>;

/** Every prop of R3F's <Canvas> (shadows, dpr, orthographic, flat, camera, gl…), plus its size. */
export interface ThreeCanvasProps extends Omit<CanvasProps, 'children' | 'frameloop' | 'onCreated'> {
  children: React.ReactNode;
  /** Width in pixels. Default: the composition's width */
  width?: number;
  /** Height in pixels. Default: the composition's height */
  height?: number;
  onCreated?: CanvasProps['onCreated'];
}

/**
 * Draws the scene once R3F has committed the frame: its effects run after its own reconciler applied the new props,
 * which can be later than the main tree's commit (R3F's root is concurrent).
 */
function FrameAdvancer({ onDrawn }: { onDrawn: () => void }): null {
  const advance = useThree((state) => state.advance);
  const { frame } = useContext(TimelineContext);
  useEffect(() => {
    advance(performance.now());
    onDrawn();
  }, [frame, advance, onDrawn]);
  return null;
}

/**
 * Wraps React Three Fiber's <Canvas> with rendiv integration:
 * - Bridges rendiv contexts into R3F's separate reconciler
 * - Sets frameloop="never" during rendering for frame-accurate capture
 * - Manages holdRender/releaseRender for Canvas initialization
 * - Preserves WebGL drawing buffer so Playwright screenshots capture the canvas
 */
export function ThreeCanvas({
  children,
  style,
  className,
  camera,
  gl,
  width: passedWidth,
  height: passedHeight,
  onCreated,
  ...canvasProps
}: ThreeCanvasProps): React.ReactElement {
  const timeline = useContext(TimelineContext);
  const sequence = useContext(SequenceContext);
  const composition = useContext(CompositionContext);
  const environment = useContext(RendivEnvironmentContext);

  const isRendering = environment.environment === 'rendering';
  const holdHandleRef = useRef<number | null>(null);

  // Hold render until Canvas is created
  useEffect(() => {
    const handle = holdRender('Initializing <ThreeCanvas>', {
      timeoutInMilliseconds: 30000,
    });
    holdHandleRef.current = handle;

    return () => {
      if (holdHandleRef.current !== null) {
        releaseRender(holdHandleRef.current);
        holdHandleRef.current = null;
      }
    };
  }, []);

  const handleCreated = useCallback(
    (state: Parameters<NonNullable<CanvasProps['onCreated']>>[0]) => {
      onCreated?.(state);

      if (isRendering) {
        state.advance(performance.now());
      }

      if (holdHandleRef.current !== null) {
        releaseRender(holdHandleRef.current);
        holdHandleRef.current = null;
      }
    },
    [isRendering, onCreated],
  );

  // In rendering mode, each frame is held from the main tree's commit (before the renderer waits for holds) until
  // FrameAdvancer has drawn it inside the canvas.
  const frameHoldRef = useRef<number | null>(null);
  const releaseFrameHold = useCallback(() => {
    if (frameHoldRef.current !== null) {
      releaseRender(frameHoldRef.current);
      frameHoldRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (!isRendering) return;
    frameHoldRef.current = holdRender(`<ThreeCanvas>: drawing frame ${timeline.frame}`, { timeoutInMilliseconds: 30000 });
    return releaseFrameHold;
  }, [timeline.frame, isRendering, releaseFrameHold]);

  const width = passedWidth ?? composition?.width ?? 1920;
  const height = passedHeight ?? composition?.height ?? 1080;

  // In rendering mode, preserve the WebGL drawing buffer so headless
  // Chromium screenshots capture the canvas content instead of a blank rect.
  const glConfig = isRendering && (gl === undefined || (typeof gl === 'object' && !('domElement' in gl)))
    ? { preserveDrawingBuffer: true, ...(gl as object | undefined) }
    : gl;

  return (
    <Canvas
      {...canvasProps}
      frameloop={isRendering ? 'never' : 'always'}
      camera={camera}
      gl={glConfig}
      resize={{ offsetSize: true }}
      onCreated={handleCreated}
      style={{ width, height, ...style }}
      className={className}
    >
      <RendivContextBridge
        timeline={timeline}
        sequence={sequence}
        composition={composition}
        environment={environment}
      >
        {isRendering && <FrameAdvancer onDrawn={releaseFrameHold} />}
        {children}
      </RendivContextBridge>
    </Canvas>
  );
}
