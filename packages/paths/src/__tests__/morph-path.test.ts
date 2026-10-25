import { describe, it, expect } from 'vitest';
import { morphPath } from '../morph-path';
import { pathBounds } from '../bounds';
import { pathLength, pointOnPath } from '../measure';
import { readPath } from '../read-path';

/** Points spread along the path by length: two paths that draw the same shape give the same points. */
function samples(d: string, n = 24) {
  const length = pathLength(d);
  return Array.from({ length: n + 1 }, (_, i) => pointOnPath(d, (length * i) / n));
}

function expectSameShape(actual: string, expected: string, tolerance = 0.5) {
  expect(pathLength(actual)).toBeCloseTo(pathLength(expected), 0);
  const a = samples(actual);
  const b = samples(expected);
  a.forEach((p, i) => {
    expect(Math.abs(p.x - b[i].x)).toBeLessThan(tolerance);
    expect(Math.abs(p.y - b[i].y)).toBeLessThan(tolerance);
  });
}

const circle = 'M 50 10 A 40 40 0 1 1 49.99 10 Z';
const star = 'M50 5 L61 39 L97 39 L68 60 L79 95 L50 74 L21 95 L32 60 L3 39 L39 39 Z';
const square = 'M10 10 H90 V90 H10 Z';
const relativeWave = 'm10 50 q20 -40 40 0 t40 0';
const twoSquares = 'M0 0 H20 V20 H0 Z M60 60 H80 V80 H60 Z';

describe('morphPath between paths of different structure', () => {
  const pairs: Array<[string, string, string]> = [
    ['circle of arcs → star of lines', circle, star],
    ['square of H/V → wave of relative quadratics', square, relativeWave],
    ['one subpath → two subpaths', square, twoSquares],
  ];

  for (const [name, from, to] of pairs) {
    it(`${name}: starts as the first and ends as the second`, () => {
      expectSameShape(morphPath(0, from, to), from);
      expectSameShape(morphPath(1, from, to), to);
    });

    it(`${name}: every step is a valid path with finite coordinates`, () => {
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const d = morphPath(p, from, to);
        for (const segment of readPath(d)) {
          for (const v of segment.values) expect(Number.isFinite(v)).toBe(true);
        }
      }
    });
  }

  it('the halfway shape lies between the two', () => {
    const half = pathBounds(morphPath(0.5, square, twoSquares));
    expect(half.x).toBeGreaterThanOrEqual(-1);
    expect(half.x + half.width).toBeLessThanOrEqual(91);
  });

  it('paths of the same structure are blended coordinate by coordinate', () => {
    const d = readPath(morphPath(0.5, 'M0 0 L10 0 L10 10 Z', 'M10 10 L30 10 L30 30 Z'));
    expect(d.map((s) => s.command)).toEqual(['M', 'L', 'L', 'Z']);
    expect(d[1].values).toEqual([20, 5]);
  });
});

describe('measuring a closed path', () => {
  it('counts the line a Z draws back to the start', () => {
    expect(pathLength('M10 10 H90 V90 H10 Z')).toBe(320);
    expect(pointOnPath('M10 10 H90 V90 H10 Z', 300)).toEqual(expect.objectContaining({ x: 10, y: 30 }));
  });

  it('a Z closes each subpath to its own start', () => {
    expect(pathLength(twoSquares)).toBe(160);
  });
});

describe('readPath', () => {
  it('reads the command that follows a Z, with or without a space', () => {
    for (const d of ['M0 0 H20 V20 H0 Z M60 60 H80', 'M0 0 H20 V20 H0ZM60 60H80', 'M0 0 H20 V20 H0 z m60 60 h20']) {
      expect(readPath(d).slice(4)).toEqual([
        { command: 'Z', values: [] },
        { command: 'M', values: [60, 60] },
        { command: 'L', values: [80, 60] },
      ]);
    }
  });
});
