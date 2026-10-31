import type { EasingFunction } from './easing';

/** Outside the input range: keep the slope (extend), hold the end value (clamp), return the input (identity) or loop over
 *  the first (or last) segment (wrap). */
export type ExtrapolationType = 'extend' | 'clamp' | 'identity' | 'wrap';

export interface InterpolateOptions {
  /** One easing for every segment, or one per segment (inputRange.length - 1 of them). */
  easing?: EasingFunction | readonly EasingFunction[];
  extrapolateLeft?: ExtrapolationType;
  extrapolateRight?: ExtrapolationType;
  /** Rounds the input down to a multiple of this first (stepped motion, e.g. on twos). */
  posterize?: number;
}

function wrapInto(value: number, min: number, max: number): number {
  const range = max - min;
  if (range === 0) return min;
  return ((((value - min) % range) + range) % range) + min;
}

function findSegment(
  input: number,
  inputRange: readonly number[]
): number {
  for (let i = 1; i < inputRange.length; i++) {
    if (input <= inputRange[i]) return i - 1;
  }
  return inputRange.length - 2;
}

function interpolateSegment(
  input: number,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number,
  easing: EasingFunction | undefined
): number {
  let t: number;
  if (inputMin === inputMax) {
    t = 0;
  } else {
    t = (input - inputMin) / (inputMax - inputMin);
  }

  if (easing) {
    t = easing(t);
  }

  return outputMin + t * (outputMax - outputMin);
}

export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options?: InterpolateOptions
): number {
  if (inputRange.length !== outputRange.length) {
    throw new Error(
      `inputRange (${inputRange.length}) and outputRange (${outputRange.length}) must have the same length.`
    );
  }
  if (inputRange.length < 2) {
    throw new Error('inputRange and outputRange must have at least 2 elements.');
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (inputRange[i] < inputRange[i - 1]) {
      throw new Error('inputRange must be monotonically non-decreasing.');
    }
  }

  const {
    easing,
    extrapolateLeft = 'extend',
    extrapolateRight = 'extend',
    posterize,
  } = options ?? {};

  if (easing !== undefined && typeof easing !== 'function' && easing.length !== inputRange.length - 1) {
    throw new Error(
      `easing has ${easing.length} entries, but there are ${inputRange.length - 1} segments: give one easing per segment.`
    );
  }
  if (posterize !== undefined && !(Number.isFinite(posterize) && posterize > 0)) {
    throw new Error(`posterize must be a positive finite number, but got ${posterize}.`);
  }
  const easingOf = (seg: number) => (typeof easing === 'function' ? easing : easing?.[seg]);
  const x = posterize === undefined ? input : Math.floor(input / posterize) * posterize;

  // Handle values below the input range
  if (x < inputRange[0]) {
    if (extrapolateLeft === 'clamp') {
      return outputRange[0];
    }
    if (extrapolateLeft === 'identity') {
      return x;
    }
    // extend: extrapolate from the first segment; wrap: loop over it
    return interpolateSegment(
      extrapolateLeft === 'wrap' ? wrapInto(x, inputRange[0], inputRange[1]) : x,
      inputRange[0],
      inputRange[1],
      outputRange[0],
      outputRange[1],
      easingOf(0)
    );
  }

  // Handle values above the input range
  if (x > inputRange[inputRange.length - 1]) {
    if (extrapolateRight === 'clamp') {
      return outputRange[outputRange.length - 1];
    }
    if (extrapolateRight === 'identity') {
      return x;
    }
    // extend: extrapolate from the last segment; wrap: loop over it
    const last = inputRange.length - 1;
    return interpolateSegment(
      extrapolateRight === 'wrap' ? wrapInto(x, inputRange[last - 1], inputRange[last]) : x,
      inputRange[last - 1],
      inputRange[last],
      outputRange[last - 1],
      outputRange[last],
      easingOf(last - 1)
    );
  }

  // Find the correct segment and interpolate
  const seg = findSegment(x, inputRange);
  return interpolateSegment(
    x,
    inputRange[seg],
    inputRange[seg + 1],
    outputRange[seg],
    outputRange[seg + 1],
    easingOf(seg)
  );
}
