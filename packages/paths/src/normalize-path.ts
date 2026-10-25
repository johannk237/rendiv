import { endpointToCenter } from './measure';
import { readPath } from './read-path';

/** One cubic Bézier piece: two control points and the end point (the start is the previous end). */
export type Cubic = [number, number, number, number, number, number];

/** A subpath drawn only with cubics: any path can be written this way without changing its shape. */
export interface CubicSubpath {
  start: [number, number];
  curves: Cubic[];
  closed: boolean;
}

const line = (x0: number, y0: number, x: number, y: number): Cubic => [
  x0 + (x - x0) / 3, y0 + (y - y0) / 3,
  x0 + ((x - x0) * 2) / 3, y0 + ((y - y0) * 2) / 3,
  x, y,
];

/** Cubics of an elliptical arc, at most a quarter turn each (the usual 4/3·tan(θ/4) handle length). */
function arcToCubics(x0: number, y0: number, values: number[]): Cubic[] {
  const [rxIn, ryIn, rotation, largeArc, sweep, x, y] = values;
  if (rxIn === 0 || ryIn === 0 || (x0 === x && y0 === y)) return [line(x0, y0, x, y)];
  const phi = (rotation * Math.PI) / 180;
  const { cx, cy, startAngle, deltaAngle } = endpointToCenter(x0, y0, x, y, rxIn, ryIn, phi, largeArc, sweep);
  // endpointToCenter scales the radii up when the arc cannot reach; recompute them the same way
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rxIn * rxIn) + (y1p * y1p) / (ryIn * ryIn);
  const rx = lambda > 1 ? Math.sqrt(lambda) * rxIn : rxIn;
  const ry = lambda > 1 ? Math.sqrt(lambda) * ryIn : ryIn;

  const pieces = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)));
  const step = deltaAngle / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (a: number) => [
    cx + rx * Math.cos(a) * cosPhi - ry * Math.sin(a) * sinPhi,
    cy + rx * Math.cos(a) * sinPhi + ry * Math.sin(a) * cosPhi,
  ];
  const derivative = (a: number) => [
    -rx * Math.sin(a) * cosPhi - ry * Math.cos(a) * sinPhi,
    -rx * Math.sin(a) * sinPhi + ry * Math.cos(a) * cosPhi,
  ];
  const curves: Cubic[] = [];
  for (let i = 0; i < pieces; i++) {
    const a1 = startAngle + i * step;
    const a2 = a1 + step;
    const [p1x, p1y] = point(a1);
    const [p2x, p2y] = i === pieces - 1 ? [x, y] : point(a2);
    const [d1x, d1y] = derivative(a1);
    const [d2x, d2y] = derivative(a2);
    curves.push([p1x + k * d1x, p1y + k * d1y, p2x - k * d2x, p2y - k * d2y, p2x, p2y]);
  }
  return curves;
}

/** The path as subpaths of cubics only (lines, quadratics and arcs converted exactly or, for arcs, closely). */
export function toCubicSubpaths(d: string): CubicSubpath[] {
  const subpaths: CubicSubpath[] = [];
  let current: CubicSubpath | null = null;
  let x = 0;
  let y = 0;
  const ensure = () => {
    if (!current) {
      current = { start: [x, y], curves: [], closed: false };
      subpaths.push(current);
    }
    return current;
  };
  for (const { command, values } of readPath(d)) {
    switch (command) {
      case 'M':
        current = { start: [values[0], values[1]], curves: [], closed: false };
        subpaths.push(current);
        [x, y] = values;
        break;
      case 'L':
        ensure().curves.push(line(x, y, values[0], values[1]));
        [x, y] = values;
        break;
      case 'C':
        ensure().curves.push(values.slice(0, 6) as Cubic);
        x = values[4];
        y = values[5];
        break;
      case 'Q': {
        const [qx, qy, ex, ey] = values;
        ensure().curves.push([x + ((qx - x) * 2) / 3, y + ((qy - y) * 2) / 3, ex + ((qx - ex) * 2) / 3, ey + ((qy - ey) * 2) / 3, ex, ey]);
        x = ex;
        y = ey;
        break;
      }
      case 'A':
        ensure().curves.push(...arcToCubics(x, y, values));
        x = values[5];
        y = values[6];
        break;
      case 'Z': {
        const sub = ensure();
        if (x !== sub.start[0] || y !== sub.start[1]) sub.curves.push(line(x, y, sub.start[0], sub.start[1]));
        sub.closed = true;
        [x, y] = sub.start;
        current = null;
        break;
      }
    }
  }
  return subpaths;
}

/** Splits a cubic in two halves (de Casteljau). */
function split(x0: number, y0: number, c: Cubic): [Cubic, Cubic] {
  const [x1, y1, x2, y2, x3, y3] = c;
  const ax = (x0 + x1) / 2, ay = (y0 + y1) / 2;
  const bx = (x1 + x2) / 2, by = (y1 + y2) / 2;
  const cx = (x2 + x3) / 2, cy = (y2 + y3) / 2;
  const dx = (ax + bx) / 2, dy = (ay + by) / 2;
  const ex = (bx + cx) / 2, ey = (by + cy) / 2;
  const mx = (dx + ex) / 2, my = (dy + ey) / 2;
  return [[ax, ay, dx, dy, mx, my], [ex, ey, cx, cy, x3, y3]];
}

/** The subpath with `count` curves, the same shape: the longest curves are split until there are enough. */
export function withCurveCount(sub: CubicSubpath, count: number): CubicSubpath {
  let curves = sub.curves.length > 0 ? sub.curves.slice() : [line(sub.start[0], sub.start[1], sub.start[0], sub.start[1])];
  while (curves.length < count) {
    let longest = 0;
    let longestLength = -1;
    let x0 = sub.start[0], y0 = sub.start[1];
    let longestStart: [number, number] = [x0, y0];
    curves.forEach((c, i) => {
      const length = Math.hypot(c[4] - x0, c[5] - y0);
      if (length > longestLength) {
        longestLength = length;
        longest = i;
        longestStart = [x0, y0];
      }
      x0 = c[4];
      y0 = c[5];
    });
    const halves = split(longestStart[0], longestStart[1], curves[longest]);
    curves = [...curves.slice(0, longest), ...halves, ...curves.slice(longest + 1)];
  }
  return { ...sub, curves };
}
