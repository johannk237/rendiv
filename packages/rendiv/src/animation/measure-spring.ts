import { springProgress, springSeconds, type SpringConfig } from './spring';

export interface GetSpringDurationOptions {
  fps: number;
  config?: SpringConfig;
  from?: number;
  to?: number;
  threshold?: number;
}

/** Frames a spring has to stay within `threshold` of its target to count as settled (a bouncy one crosses it). */
const SETTLED_FRAMES = 20;

/**
 * Frames a spring takes to settle: from then on it stays within `threshold` (a fraction of the distance from `from`
 * to `to`) of its target.
 */
export function getSpringDuration(options: GetSpringDurationOptions): number {
  const { fps, config, threshold = 0.005 } = options;

  if (threshold <= 0) return Infinity;
  if (threshold >= 1) return 0;

  const maxFrames = fps * 600; // 10 minutes
  const off = (frame: number) => {
    let p = springProgress(springSeconds(frame, fps), config);
    if (config?.clampOvershoot ?? config?.overshootClamping) p = Math.min(p, 1);
    return Math.abs(1 - p) >= threshold;
  };

  let frame = 0;
  while (off(frame) && frame < maxFrames) frame++;
  let settled = frame;
  for (let quiet = 0; quiet < SETTLED_FRAMES && frame < maxFrames; quiet++) {
    frame++;
    if (off(frame)) {
      quiet = 0;
      settled = frame + 1;
    }
  }
  return settled;
}
