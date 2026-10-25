import React, { forwardRef, useImperativeHandle, useMemo, useRef, type ComponentType, type CSSProperties } from 'react';
import {
  CompositionStage,
  fitComposition,
  hasOwnHeight,
  useElementSize,
  type ErrorFallbackProps,
} from './composition-stage';

export interface ThumbnailProps {
  component: ComponentType<Record<string, unknown>>;
  /** The frame shown. */
  frameToDisplay: number;
  durationInFrames: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
  compositionId?: string;
  inputProps?: Record<string, unknown>;
  /** Without a height, as tall as the composition at its width; with one, the composition fits inside. */
  style?: CSSProperties;
  className?: string;
  errorFallback?: ComponentType<ErrorFallbackProps>;
  /** Background around the composition when it does not fill the thumbnail. Default: transparent */
  backgroundColor?: string;
}

export interface ThumbnailRef {
  getContainerNode: () => HTMLDivElement | null;
  getScale: () => number;
}

/** One frame of a composition, still (no playback, no sound). */
export const Thumbnail = forwardRef<ThumbnailRef, ThumbnailProps>((props, ref) => {
  const {
    component,
    frameToDisplay,
    durationInFrames,
    fps,
    compositionWidth,
    compositionHeight,
    compositionId = 'thumbnail',
    inputProps: passedInputProps,
    style,
    className,
    errorFallback,
    backgroundColor,
  } = props;
  const emptyProps = useMemo(() => ({}), []);
  const inputProps = passedInputProps ?? emptyProps;
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useElementSize(containerRef);
  const fitHeight = hasOwnHeight(style);
  const { scale, offsetX, offsetY } = fitComposition(
    containerSize,
    { width: compositionWidth, height: compositionHeight },
    fitHeight,
  );
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const silent = useMemo(() => ({ muted: true, volume: 0 }), []);

  useImperativeHandle(ref, () => ({
    getContainerNode: () => containerRef.current,
    getScale: () => scaleRef.current,
  }), []);

  const frame = Math.max(0, Math.min(Math.round(frameToDisplay), durationInFrames - 1));

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        ...(fitHeight ? {} : { height: compositionHeight * scale }),
        backgroundColor,
        ...style,
      }}
    >
      <CompositionStage
        component={component}
        inputProps={inputProps}
        compositionId={compositionId}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        fps={fps}
        durationInFrames={durationInFrames}
        frame={frame}
        playing={false}
        mediaVolume={silent}
        scale={scale}
        offsetX={offsetX}
        offsetY={offsetY}
        errorFallback={errorFallback}
      />
    </div>
  );
});

Thumbnail.displayName = 'Thumbnail';
