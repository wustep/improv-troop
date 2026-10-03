/** Small seeded PRNG (mulberry32) so the same settings give the same take. */
export interface Rng {
  next(): number; // [0, 1)
  int(lo: number, hi: number): number; // inclusive
  pick<T>(xs: readonly T[]): T;
  weighted<T>(xs: readonly T[], weights: readonly number[]): T;
  chance(p: number): boolean;
  fork(label: string | number): Rng;
  seed: number;
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed,
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    weighted: (xs, weights) => {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < xs.length; i++) {
        r -= weights[i];
        if (r <= 0) return xs[i];
      }
      return xs[xs.length - 1];
    },
    chance: (p) => next() < p,
    fork: (label) => makeRng(hashString(`${seed}:${label}`)),
  };
  return rng;
}
