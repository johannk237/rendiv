import type { ShapeResult } from './types';

export interface ShapeHeartOptions {
  /** Height of the heart */
  size: number;
  /** Width over height. Default: 1.1 */
  aspectRatio?: number;
  /** Rounder (positive) or sharper (negative) bottom tip. Default: 0 */
  bottomRoundnessAdjustment?: number;
  /** Deeper (positive) or shallower (negative) dip between the lobes. Default: 0 */
  depthAdjustment?: number;
}

export function shapeHeart({
  size,
  aspectRatio = 1.1,
  bottomRoundnessAdjustment = 0,
  depthAdjustment = 0,
}: ShapeHeartOptions): ShapeResult {
  if (size <= 0) {
    throw new Error('shapeHeart: size must be positive');
  }

  const w = size * aspectRatio;
  const h = size;
  const r = w / 4;
  const dip = h * (0.22 + depthAdjustment);
  const tipCtl = h * (0.62 + bottomRoundnessAdjustment);
  // Two lobes meeting at the dip, then curves down to the tip.
  const d = [
    `M ${w / 2} ${dip}`,
    `C ${w / 2} ${dip - r * 1.3} ${w / 2 - 2 * r} ${dip - r * 1.3} ${w / 2 - 2 * r} ${dip + r * 0.2}`,
    `C ${w / 2 - 2 * r} ${tipCtl} ${w / 2} ${tipCtl} ${w / 2} ${h}`,
    `C ${w / 2} ${tipCtl} ${w / 2 + 2 * r} ${tipCtl} ${w / 2 + 2 * r} ${dip + r * 0.2}`,
    `C ${w / 2 + 2 * r} ${dip - r * 1.3} ${w / 2} ${dip - r * 1.3} ${w / 2} ${dip}`,
    'Z',
  ].join(' ');

  return {
    d,
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`,
  };
}
