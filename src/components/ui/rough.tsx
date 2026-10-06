"use client";

import rough from "roughjs";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

// Hand-drawn UI primitives: rough.js borders/hatching generated from the element's
// measured size with a stable seed, so shapes don't jitter on re-render.

const gen = rough.generator();

function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width + parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).paddingRight));
      const h = Math.round(e.contentRect.height + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom));
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// Line-work tokens come from the theme (globals.css): stroke widths are the border tokens,
// looseness is the Jamming --sketch-* extension.
function themeNumber(name: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}
export type StrokeWeight = "s" | "m" | "l";

export interface RoughStyle {
  stroke?: string;
  /** a border token */
  weight?: StrokeWeight;
  fill?: string;
  /** a solid wash laid under the line work, e.g. a highlighter or a coloured-in button */
  wash?: string;
  fillStyle?: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots" | "dashed" | "zigzag-line";
  hachureGap?: number;
  hachureAngle?: number;
  fillWeight?: number;
  roughness?: number;
  bowing?: number;
  shape?: "rect" | "ellipse" | "pill";
}

function RoughSvg({ w, h, seed, s }: { w: number; h: number; seed: string; s: RoughStyle }) {
  const paths = useMemo(() => {
    if (w < 4 || h < 4) return [];
    const pad = 3;
    const opts = {
      seed: seedOf(seed),
      stroke: s.stroke ?? "var(--ink)",
      strokeWidth: themeNumber(`--border-${s.weight ?? "m"}`, 1.5),
      roughness: s.roughness ?? themeNumber("--sketch-roughness", 1.3),
      bowing: s.bowing ?? themeNumber("--sketch-bowing", 1.2),
      fill: s.fill,
      fillStyle: s.fillStyle ?? "hachure",
      hachureGap: s.hachureGap ?? themeNumber("--sketch-hachure-gap", 4.5),
      hachureAngle: s.hachureAngle ?? -41,
      fillWeight: s.fillWeight ?? 1.2,
      disableMultiStroke: false,
    };
    const shape = (o: typeof opts) => {
      if (s.shape === "ellipse") return gen.ellipse(w / 2, h / 2, w - pad * 2, h - pad * 2, o);
      if (s.shape === "pill") {
        const r = Math.min(h / 2 - pad, 18);
        const x0 = pad;
        const y0 = pad;
        const x1 = w - pad;
        const y1 = h - pad;
        const p = `M${x0 + r},${y0} L${x1 - r},${y0} Q${x1},${y0} ${x1},${y0 + r} L${x1},${y1 - r} Q${x1},${y1} ${x1 - r},${y1} L${x0 + r},${y1} Q${x0},${y1} ${x0},${y1 - r} L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} Z`;
        return gen.path(p, o);
      }
      return gen.rectangle(pad, pad, w - pad * 2, h - pad * 2, o);
    };
    const wash = s.wash ? gen.toPaths(shape({ ...opts, seed: opts.seed + 1, stroke: "none", fill: s.wash, fillStyle: "solid" })) : [];
    return [...wash, ...gen.toPaths(shape(opts))];
  }, [w, h, seed, s.stroke, s.weight, s.fill, s.wash, s.fillStyle, s.hachureGap, s.hachureAngle, s.fillWeight, s.roughness, s.bowing, s.shape]);
  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h} aria-hidden>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? "none"} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export function RoughBox({
  seed,
  rough: rs = {},
  className = "",
  style,
  children,
  as: Tag = "div",
  ...rest
}: { seed: string; rough?: RoughStyle; className?: string; style?: CSSProperties; children?: ReactNode; as?: "div" | "section" | "aside" } & HTMLAttributes<HTMLElement>) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  return (
    <Tag ref={ref as never} className={`relative ${className}`} style={style} {...rest}>
      <RoughSvg w={w} h={h} seed={seed} s={rs} />
      <div className="relative">{children}</div>
    </Tag>
  );
}

export function RoughButton({
  seed,
  tone = "plain",
  active = false,
  shape = "rect",
  className = "",
  children,
  ...rest
}: {
  seed: string;
  tone?: "plain" | "primary" | "go" | "quiet";
  active?: boolean;
  shape?: RoughStyle["shape"];
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [ref, { w, h }] = useSize<HTMLButtonElement>();
  const [hover, setHover] = useState(false);
  // Selected reads as a highlighter wash (no lines through the label); hover is a light hatch.
  // The filled tones are coloured in solid, so their label keeps its contrast.
  const looks: Record<string, Pick<RoughStyle, "wash" | "fill" | "weight">> = {
    plain: { wash: active ? "var(--color-2-transparent)" : undefined, fill: hover && !active ? "var(--color-2-transparent)" : undefined, weight: active ? "l" : "m" },
    primary: { wash: "var(--color-1)", fill: hover ? "var(--neutral-9-transparent)" : undefined, weight: "l" },
    go: { wash: "var(--color-4)", fill: hover ? "var(--neutral-9-transparent)" : undefined, weight: "l" },
    quiet: { wash: active ? "var(--neutral-9-transparent)" : undefined, fill: hover ? "var(--neutral-7-transparent)" : undefined, weight: "m" },
  };
  return (
    <button
      ref={ref}
      type="button"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className={`relative cursor-pointer select-none transition-transform duration-(--motion-duration) ease-small active:translate-y-(--motion-press-distance) disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      aria-pressed={tone === "plain" || tone === "quiet" ? active : undefined}
      {...rest}
    >
      <RoughSvg w={w} h={h} seed={seed} s={{ ...looks[tone], fillStyle: "hachure", shape }} />
      <span className="relative">{children}</span>
    </button>
  );
}

function squigglePaths(width: number, seed: string): string[] {
  let h = seedOf(seed);
  const rnd = () => {
    h = (h * 16807) % 2147483647;
    return h / 2147483647;
  };
  const stroke = (dy: number) => {
    let d = `M0 ${(5 + dy).toFixed(1)}`;
    for (let x = 10; x <= width; x += 10) {
      const y = 5 + dy + Math.sin(x / 9) * 2.2 + (rnd() - 0.5) * 1.2;
      d += ` Q${(x - 5).toFixed(1)} ${(y + (rnd() - 0.5) * 2).toFixed(1)} ${x} ${y.toFixed(1)}`;
    }
    return d;
  };
  return [stroke(0), stroke(0.8)];
}

/** Hand-drawn underline / squiggle divider (deterministic, so SSR and client agree). */
export function Squiggle({ width = 120, seed = "sq", color = "var(--ink)", className = "" }: { width?: number; seed?: string; color?: string; className?: string }) {
  const paths = useMemo(() => squigglePaths(width, seed), [width, seed]);
  return (
    <svg width={width} height={10} className={className} aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} stroke={color} strokeWidth={i ? 1 : 1.6} strokeOpacity={i ? 0.6 : 1} fill="none" strokeLinecap="round" />
      ))}
    </svg>
  );
}
