import type { ComponentType, CSSProperties, ReactNode } from 'react';

export interface TransitionStyles {
  entering: CSSProperties;
  exiting: CSSProperties;
}

/** A transition as two styles, one for each scene, computed from the progress (0 → 1). */
export interface TransitionStylePresentation {
  style: (progress: number) => TransitionStyles;
}

/** What a presentation component receives: one of the two scenes, and where the transition is. */
export interface TransitionPresentationComponentProps<PassedProps = Record<string, unknown>> {
  children: ReactNode;
  /** The scene being wrapped: the one leaving ('exiting') or the one arriving ('entering'). */
  presentationDirection: 'entering' | 'exiting';
  /** 0 when the transition starts, approaching 1 when it ends. */
  presentationProgress: number;
  presentationDurationInFrames: number;
  /** The `props` of the presentation. */
  passedProps: PassedProps;
}

/** A transition as a component that wraps each of the two scenes (anything a style cannot do: overlays, layers). */
export interface TransitionComponentPresentation<PassedProps = Record<string, unknown>> {
  component: ComponentType<TransitionPresentationComponentProps<PassedProps>>;
  props: PassedProps;
}

export type TransitionPresentation<PassedProps = Record<string, unknown>> =
  | TransitionStylePresentation
  | TransitionComponentPresentation<PassedProps>;

export interface TransitionTiming {
  durationInFrames: number;
  /** Progress at `frame` of the transition (0 → 1). `fps` is the composition's. */
  progress: (frame: number, fps: number) => number;
}
