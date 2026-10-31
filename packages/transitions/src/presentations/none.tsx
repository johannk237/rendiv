import React from 'react';
import { Fill } from '@rendiv/core';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '../types';

function None({ children }: TransitionPresentationComponentProps<Record<string, never>>) {
  return <Fill>{children}</Fill>;
}

/** The scenes overlap without any effect: the arriving one simply covers the leaving one. */
export function none(): TransitionPresentation<Record<string, never>> {
  return { component: None, props: {} };
}
