// Tiny 2D affine helpers. Matrices are [a, b, c, d, e, f] like SVG's matrix():
//   x' = a·x + c·y + e,  y' = b·x + d·y + f

export type Mat = [number, number, number, number, number, number];
export interface Pt {
  x: number;
  y: number;
}

export const I: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const tr = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];

export function rot(deg: number, cx = 0, cy = 0): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

export function scl(sx: number, sy = sx, cx = 0, cy = 0): Mat {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

/** Compose left-to-right: chain(a, b, c) = a·b·c (c applied first). */
export function chain(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => mul(acc, m), I);
}

export function ap(m: Mat, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function attr(m: Mat): string {
  return `matrix(${m[0].toFixed(4)} ${m[1].toFixed(4)} ${m[2].toFixed(4)} ${m[3].toFixed(4)} ${m[4].toFixed(2)} ${m[5].toFixed(2)})`;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Exponential approach factor for a time constant (seconds) over dt. */
export const approach = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(tau, 1e-4));
