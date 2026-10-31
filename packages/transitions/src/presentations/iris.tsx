import React from 'react';
import { Fill } from '@rendiv/core';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '../types';

export interface IrisOptions {
  /** Size of the composition in px: the circle grows until it covers the corners. */
  width: number;
  height: number;
}

function Iris({ children, presentationDirection, presentationProgress, passedProps }: TransitionPresentationComponentProps<IrisOptions>) {
  const { width, height } = passedProps;
  const radius = (Math.sqrt(width ** 2 + height ** 2) / 2) * presentationProgress;
  const clipPath = presentationDirection === 'entering' ? `circle(${radius}px at ${width / 2}px ${height / 2}px)` : undefined;
  return <Fill style={{ clipPath }}>{children}</Fill>;
}

/** The arriving scene appears in a circle growing from the centre of the frame. */
export function iris(options: IrisOptions): TransitionPresentation<IrisOptions> {
  return { component: Iris, props: options };
}
