import { readPath, writePath } from './read-path';
import { toCubicSubpaths, withCurveCount, type CubicSubpath } from './normalize-path';
import type { PathSegment } from './types';

const sameStructure = (a: PathSegment[], b: PathSegment[]) =>
  a.length === b.length && a.every((s, i) => s.command === b[i].command && s.values.length === b[i].values.length);

/** Any two paths: both rewritten as cubics, with as many subpaths and curves each, then blended point by point. */
function morphAny(p: number, from: string, to: string): string {
  const a = toCubicSubpaths(from);
  const b = toCubicSubpaths(to);
  // A missing subpath grows from (or shrinks to) a point: the start of the other path's last subpath
  const pad = (subs: CubicSubpath[], other: CubicSubpath[]) => {
    const anchor = subs[subs.length - 1]?.start ?? other[0]?.start ?? [0, 0];
    while (subs.length < other.length) subs.push({ start: [anchor[0], anchor[1]], curves: [], closed: other[subs.length].closed });
  };
  pad(a, b);
  pad(b, a);
  const mix = (u: number, v: number) => u + (v - u) * p;
  const parts = a.map((subA, i) => {
    const count = Math.max(subA.curves.length, b[i].curves.length, 1);
    const sa = withCurveCount(subA, count);
    const sb = withCurveCount(b[i], count);
    const segments: PathSegment[] = [
      { command: 'M', values: [mix(sa.start[0], sb.start[0]), mix(sa.start[1], sb.start[1])] },
      ...sa.curves.map((c, j) => ({ command: 'C', values: c.map((v, k) => mix(v, sb.curves[j][k])) })),
    ];
    if (p < 0.5 ? sa.closed : sb.closed) segments.push({ command: 'Z', values: [] });
    return segments;
  });
  return writePath(parts.flat());
}

/**
 * Morph between two SVG paths.
 *
 * Paths with the same structure (same commands, e.g. two polygons with the same number of sides) are blended
 * coordinate by coordinate. Any other pair (a circle of arcs and a star of lines, different numbers of points or
 * subpaths) is first rewritten as cubic curves with as many pieces on each side, so any shape morphs into any other.
 *
 * @param progress - Value from 0 (fully `from`) to 1 (fully `to`)
 * @param from - Starting SVG path `d` string
 * @param to - Ending SVG path `d` string
 * @returns Interpolated SVG path `d` string
 */
export function morphPath(progress: number, from: string, to: string): string {
  const p = Math.max(0, Math.min(1, progress));
  const segA = readPath(from);
  const segB = readPath(to);

  if (!sameStructure(segA, segB)) return morphAny(p, from, to);

  const result = segA.map((a, i) => {
    const b = segB[i];
    // Arc flags (large-arc, sweep) are 0 or 1: they switch half way instead of blending
    const values = a.values.map((va, j) => (a.command === 'A' && (j === 3 || j === 4) ? (p < 0.5 ? va : b.values[j]) : va + (b.values[j] - va) * p));
    return { command: a.command, values };
  });

  return writePath(result);
}
