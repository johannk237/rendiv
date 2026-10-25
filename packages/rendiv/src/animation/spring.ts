export interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  clampOvershoot?: boolean;
  /** Same as `clampOvershoot` (the name other frame-based libraries use). */
  overshootClamping?: boolean;
}

export interface SpringOptions {
  frame: number;
  fps: number;
  config?: SpringConfig;
  from?: number;
  to?: number;
  durationInFrames?: number;
  durationRestThreshold?: number;
  /** Frames to wait before the spring starts. Default: 0 */
  delay?: number;
}

/** A frame is never simulated as more than this many seconds (keeps very low frame rates stable). */
const MAX_STEP_SECONDS = 0.064;

/**
 * Position of a spring released at 0 with no velocity, pulled towards 1, after `seconds`.
 * Closed-form solution of the damped harmonic oscillator, so it is exact at any frame and costs the same at frame 1000
 * as at frame 1. Damping ratios of 1 and above use the critically damped curve: a heavily damped spring
 * (e.g. damping 200) eases in quickly instead of crawling towards its target.
 */
export function springProgress(
  seconds: number,
  { damping = 10, mass = 1, stiffness = 100 }: Pick<SpringConfig, 'damping' | 'mass' | 'stiffness'> = {},
): number {
  if (damping <= 0) {
    throw new Error('spring(): damping must be greater than 0, otherwise the spring never settles.');
  }
  if (seconds <= 0) return 0;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const omega1 = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * seconds);
    return 1 - envelope * (Math.cos(omega1 * seconds) + ((zeta * omega0) / omega1) * Math.sin(omega1 * seconds));
  }
  return 1 - Math.exp(-omega0 * seconds) * (1 + omega0 * seconds);
}

/** Seconds of simulated time at `frame` (each frame advances 1/fps, capped for very low frame rates). */
export function springSeconds(frame: number, fps: number): number {
  return Math.max(0, frame) * Math.min(1 / fps, MAX_STEP_SECONDS);
}

export function spring(options: SpringOptions): number {
  const {
    frame: passedFrame,
    fps,
    config = {},
    from = 0,
    to = 1,
    durationInFrames,
    delay = 0,
  } = options;

  const clampOvershoot = config.clampOvershoot ?? config.overshootClamping ?? false;
  const frame = passedFrame - delay;

  if (frame < 0) return from;

  if (durationInFrames !== undefined && frame >= durationInFrames) {
    return to;
  }

  let progress = springProgress(springSeconds(frame, fps), config);
  if (clampOvershoot) progress = Math.min(progress, 1);

  return from + progress * (to - from);
}
