import { describe, it, expect } from 'vitest';
import { shapeHeart } from '../heart';

describe('shapeHeart', () => {
  it('is size high and size * aspectRatio wide', () => {
    const heart = shapeHeart({ size: 100 });
    expect(heart.height).toBe(100);
    expect(heart.width).toBeCloseTo(110);
    expect(heart.viewBox).toBe(`0 0 ${heart.width} 100`);
  });

  it('is one closed path from the dip down to the tip', () => {
    const { d } = shapeHeart({ size: 100, aspectRatio: 1 });
    expect(d.startsWith('M 50 22')).toBe(true);
    expect(d).toContain(' 50 100 ');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('rejects a size that is not positive', () => {
    expect(() => shapeHeart({ size: 0 })).toThrow();
  });
});
