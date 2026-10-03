// Hand-drawn primitives. Shapes are generated once with a seeded rough.js
// generator (so server and client agree) and rendered as static paths; nothing
// here runs per frame, which keeps the crayon look cheap to animate.

import rough from "roughjs";
import type { ReactNode } from "react";

type Options = NonNullable<Parameters<ReturnType<typeof rough.generator>["path"]>[1]>;

const gen = rough.generator();

export const PAPER = "#f6f0e1";
export const PENCIL = "#2c2a35";
export const BLUSH = "#f08c9a";

// ─── Color helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** Lighter tint toward the paper color. */
export const tint = (c: string, t = 0.55) => mix(c, PAPER, t);

/** Stable small hash for seeds. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483646 || 7;
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface Stroke {
  d: string;
  stroke: string;
  w: number;
  fill?: string;
  op?: number;
  dash?: string;
}

export interface DrawStyle {
  ink: string;
  /** Hatch color. Omit for no hatch. */
  hatch?: string;
  /** Solid under-fill so shapes are opaque. Omit for transparent. */
  base?: string;
  seed: number;
  rough?: number;
  w?: number;
  gap?: number;
  angle?: number;
  hatchW?: number;
  /** Skip the outline entirely (hatch-only patches like blush). */
  noStroke?: boolean;
  /** Crayon break-up of the outline. */
  dash?: boolean;
  bowing?: number;
}

const CRAYON_DASH = "9 1.2 5 0.8 14 1.4";

function paths(d: string, s: DrawStyle): Stroke[] {
  const out: Stroke[] = [];
  const common: Options = {
    seed: s.seed,
    roughness: s.rough ?? 1.1,
    bowing: s.bowing ?? 1,
    preserveVertices: false,
  };
  if (s.base) {
    const base = gen.path(d, {
      ...common,
      seed: s.seed + 11,
      roughness: 0.35,
      fill: s.base,
      fillStyle: "solid",
      stroke: "none",
    });
    for (const p of gen.toPaths(base)) {
      if (p.fill && p.fill !== "none") out.push({ d: p.d, stroke: "none", w: 0, fill: p.fill });
    }
  }
  if (s.hatch) {
    const h = gen.path(d, {
      ...common,
      seed: s.seed + 23,
      fill: s.hatch,
      fillStyle: "hachure",
      hachureAngle: s.angle ?? -52,
      hachureGap: s.gap ?? 3.4,
      fillWeight: s.hatchW ?? 1.25,
      stroke: "none",
    });
    for (const p of gen.toPaths(h)) {
      if (p.stroke !== "none") out.push({ d: p.d, stroke: p.stroke, w: p.strokeWidth, op: 0.8 });
    }
  }
  if (!s.noStroke) {
    const o = gen.path(d, { ...common, stroke: s.ink, strokeWidth: s.w ?? 2.1 });
    for (const p of gen.toPaths(o)) {
      out.push({ d: p.d, stroke: p.stroke, w: p.strokeWidth, dash: s.dash === false ? undefined : CRAYON_DASH });
    }
  }
  return out;
}

const cache = new Map<string, Stroke[]>();

/** Sketch an arbitrary SVG path. Memoized by (d, style). */
export function sketch(d: string, s: DrawStyle): Stroke[] {
  const key = d + "|" + JSON.stringify(s);
  let v = cache.get(key);
  if (!v) {
    v = paths(d, s);
    cache.set(key, v);
  }
  return v;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  // Two arcs — rough.js samples it into a wobbly ellipse.
  return `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0 Z`;
}

export function rectPath(x: number, y: number, w: number, h: number, r = 0): string {
  if (!r) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  return `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
}

export function Sk({ strokes, className }: { strokes: Stroke[]; className?: string }) {
  return (
    <g className={className}>
      {strokes.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke}
          strokeWidth={p.w || undefined}
          fill={p.fill ?? "none"}
          strokeOpacity={p.op}
          strokeDasharray={p.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

/** Convenience: sketch + render. */
export function S(props: { d: string } & DrawStyle & { className?: string }): ReactNode {
  const { d, className, ...style } = props;
  return <Sk strokes={sketch(d, style)} className={className} />;
}

/** A plain wobbly line (no fill), e.g. whiskers, strings, hatch marks. */
export function L(props: { d: string; ink: string; seed: number; w?: number; rough?: number; op?: number }) {
  const strokes = sketch(props.d, { ink: props.ink, seed: props.seed, w: props.w ?? 1.6, rough: props.rough ?? 0.8, dash: false });
  return (
    <g strokeOpacity={props.op}>
      <Sk strokes={strokes} />
    </g>
  );
}
