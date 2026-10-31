import React from 'react';
import { Easing, Fill, interpolate } from '@rendiv/core';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '../types';

export interface PushCutOptions {
  /** Where in the transition (0–1) the cut happens. Default: 5/11 */
  cutProgress?: number;
  /** Scale the leaving scene punches in to before the cut. Default: 1.04 */
  outgoingScale?: number;
  /** Scale of the arriving scene at the cut, then at the end. Defaults: 1.04, 1.07 */
  incomingStartScale?: number;
  incomingEndScale?: number;
  transformOrigin?: string;
  /** Colour and peak opacity of the flash at the cut, and how many frames it fades over. Defaults: #f5f2ed, 0.2, 2 */
  flashColor?: string;
  flashOpacity?: number;
  flashFrames?: number;
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function validate(options: PushCutOptions) {
  const finite = (name: string, v: number) => {
    if (!Number.isFinite(v)) throw new TypeError(`${name} passed to pushCut() must be finite, received ${v}`);
  };
  const { cutProgress = 5 / 11, outgoingScale = 1.04, incomingStartScale = 1.04, incomingEndScale = 1.07, flashOpacity = 0.2, flashFrames = 2 } = options;
  finite('cutProgress', cutProgress);
  if (cutProgress <= 0 || cutProgress >= 1) throw new TypeError(`cutProgress passed to pushCut() must be greater than 0 and less than 1, received ${cutProgress}`);
  for (const [name, v] of [['outgoingScale', outgoingScale], ['incomingStartScale', incomingStartScale], ['incomingEndScale', incomingEndScale]] as const) {
    finite(name, v);
    if (v <= 0) throw new TypeError(`${name} passed to pushCut() must be greater than 0, received ${v}`);
  }
  finite('flashOpacity', flashOpacity);
  if (flashOpacity < 0 || flashOpacity > 1) throw new TypeError(`flashOpacity passed to pushCut() must be between 0 and 1, received ${flashOpacity}`);
  finite('flashFrames', flashFrames);
  if (flashFrames < 0) throw new TypeError(`flashFrames passed to pushCut() must be greater than or equal to 0, received ${flashFrames}`);
}

function PushCut({ children, presentationDirection, presentationDurationInFrames, presentationProgress: p, passedProps }: TransitionPresentationComponentProps<PushCutOptions>) {
  const {
    cutProgress = 5 / 11, outgoingScale = 1.04, incomingStartScale = 1.04, incomingEndScale = 1.07,
    transformOrigin = '50% 50%', flashColor = '#f5f2ed', flashOpacity: peak = 0.2, flashFrames = 2,
  } = passedProps;
  const entering = presentationDirection === 'entering';
  const frames = Math.max(1, presentationDurationInFrames);
  const scale = entering
    ? interpolate(interpolate(p, [cutProgress, 1], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) }), [0, 1], [incomingStartScale, incomingEndScale])
    : interpolate(interpolate(p, [0, cutProgress], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) }), [0, 1], [1, outgoingScale]);
  // The flash rises over the frame before the cut (on the leaving scene) and fades over flashFrames after it
  const flash = entering
    ? interpolate(p, [cutProgress, cutProgress + flashFrames / frames], [peak, 0], clamp)
    : interpolate(p, [cutProgress - 1 / frames, cutProgress], [0, peak], clamp);
  return (
    <Fill style={{ opacity: entering && p < cutProgress ? 0 : 1, overflow: 'hidden' }}>
      <Fill style={{ transform: `scale(${scale})`, transformOrigin, willChange: 'transform' }}>{children}</Fill>
      {flash > 0 ? <Fill style={{ backgroundColor: flashColor, opacity: flash, pointerEvents: 'none' }} /> : null}
    </Fill>
  );
}

/** A hard cut: the leaving scene punches in, the arriving one appears at the cut point and keeps pushing, with a flash. */
export function pushCut(options: PushCutOptions = {}): TransitionPresentation<PushCutOptions> {
  validate(options);
  return { component: PushCut, props: options };
}
