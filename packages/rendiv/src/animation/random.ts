/** 32-bit string hash (the classic `h * 31 + c` used by Java's String.hashCode). */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(hash, 31) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Mulberry32: one step of a small, fast 32-bit generator, mapped to [0, 1). */
function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Deterministic pseudo-random number in [0, 1): the same seed always gives the same number, so every frame
 * (and every render) sees the same value. Pass `null` for a non-deterministic `Math.random()`.
 */
export function random(seed: string | number | null): number {
  if (seed === null) return Math.random();
  if (typeof seed === 'string') return mulberry32(hashString(seed));
  if (typeof seed === 'number') return mulberry32(seed * 10000000000);
  throw new TypeError('random() expects a string, a number or null as seed.');
}
