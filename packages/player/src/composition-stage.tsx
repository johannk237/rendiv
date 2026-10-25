import React, { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import {
  TimelineContext,
  CompositionContext,
  RendivEnvironmentContext,
  MediaVolumeContext,
  type CompositionConfig,
  type MediaVolumeContextValue,
} from '@rendiv/core';
import { ErrorBoundary } from './ErrorBoundary';

export interface ErrorFallbackProps {
  error: Error;
}

/** Size of an element, kept up to date. */
export function useElementSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * How large the composition is drawn in its container: as wide as the container, or — when the container has a
 * height of its own — as large as fits in both directions (centred, the rest left as background).
 */
export function fitComposition(
  container: { width: number; height: number } | null,
  composition: { width: number; height: number },
  fitHeight: boolean,
): { scale: number; offsetX: number; offsetY: number } {
  if (!container || container.width <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const byWidth = container.width / composition.width;
  if (!fitHeight || container.height <= 0) return { scale: byWidth, offsetX: 0, offsetY: 0 };
  const scale = Math.min(byWidth, container.height / composition.height);
  return {
    scale,
    offsetX: (container.width - composition.width * scale) / 2,
    offsetY: (container.height - composition.height * scale) / 2,
  };
}

/** True when the style gives the container a height of its own (then the composition fits inside it). */
export const hasOwnHeight = (style: CSSProperties | undefined) => style?.height !== undefined || style?.aspectRatio !== undefined;

export interface CompositionStageProps {
  component: ComponentType<Record<string, unknown>>;
  inputProps: Record<string, unknown>;
  compositionId: string;
  compositionWidth: number;
  compositionHeight: number;
  fps: number;
  durationInFrames: number;
  frame: number;
  playing: boolean;
  mediaVolume: MediaVolumeContextValue;
  scale: number;
  offsetX: number;
  offsetY: number;
  errorFallback?: ComponentType<ErrorFallbackProps>;
}

/** The composition at one frame, with the contexts its components read, scaled into its container. */
export function CompositionStage({
  component: Component,
  inputProps,
  compositionId,
  compositionWidth,
  compositionHeight,
  fps,
  durationInFrames,
  frame,
  playing,
  mediaVolume,
  scale,
  offsetX,
  offsetY,
  errorFallback,
}: CompositionStageProps): React.ReactElement {
  const videoConfig = useMemo<CompositionConfig>(
    () => ({
      id: compositionId,
      width: compositionWidth,
      height: compositionHeight,
      fps,
      durationInFrames,
      defaultProps: inputProps,
    }),
    [compositionId, compositionWidth, compositionHeight, fps, durationInFrames, inputProps]
  );

  const playingRef = useRef(playing);
  playingRef.current = playing;
  const timelineValue = useMemo(
    () => ({ frame, playing, playingRef }),
    [frame, playing]
  );

  const environmentValue = useMemo(() => ({ environment: 'player' as const }), []);

  return (
    <div
      style={{
        position: 'absolute',
        left: offsetX,
        top: offsetY,
        width: compositionWidth,
        height: compositionHeight,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        overflow: 'hidden',
      }}
    >
      <RendivEnvironmentContext.Provider value={environmentValue}>
        <MediaVolumeContext.Provider value={mediaVolume}>
          <CompositionContext.Provider value={videoConfig}>
            <TimelineContext.Provider value={timelineValue}>
              <ErrorBoundary fallback={errorFallback}>
                <Component {...inputProps} />
              </ErrorBoundary>
            </TimelineContext.Provider>
          </CompositionContext.Provider>
        </MediaVolumeContext.Provider>
      </RendivEnvironmentContext.Provider>
    </div>
  );
}
