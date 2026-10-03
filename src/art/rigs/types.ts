import type { ReactNode } from "react";
import type { AnimalId, MemberFrameState } from "@/music/types";
import type { Mat, Pt } from "../affine";

/** Ref registry: rigs grab DOM nodes by key, no React state involved. */
export class Bag {
  el: Record<string, SVGElement | null> = {};
  private fns: Record<string, (e: SVGElement | null) => void> = {};
  r(key: string) {
    let f = this.fns[key];
    if (!f) {
      f = (e: SVGElement | null) => {
        this.el[key] = e;
      };
      this.fns[key] = f;
    }
    return f;
  }
  set(key: string, name: string, value: string | number) {
    const e = this.el[key];
    if (e) e.setAttribute(name, typeof value === "number" ? value.toFixed(2) : value);
  }
  tf(key: string, value: string) {
    const e = this.el[key];
    if (e) e.setAttribute("transform", value);
  }
  op(key: string, value: number) {
    const e = this.el[key];
    if (e) (e as SVGElement).style.opacity = value.toFixed(3);
  }
}

export interface RigCtx {
  bag: Bag;
  animal: AnimalId;
  ink: string;
  fill: string;
  light: string;
  seed: number;
  /** Where this animal's mouth is (mouthpieces go here). */
  mouth: Pt;
  /** Persistent per-sprite runtime memory for the rig. */
  mem: Record<string, number>;
}

export interface ArmTarget {
  hand: Pt;
  /** Elbow bend direction/amount (px). Positive bends outward. */
  bend?: number;
  /** Paw squash for chords / grip (x scale). */
  spread?: number;
  /** Hide the paw (e.g. it's inside a drawn glove). */
  hidePaw?: boolean;
  pawRot?: number;
}

export interface Look {
  /** Wind instrument at the mouth: hide the mouth line, show cheeks. */
  mouthCovered: boolean;
  /** 0..1 cheek puff. */
  cheeks: number;
  /** 0..1 inhale (chest expands). */
  inhale: number;
  /** Close eyes blissfully. */
  bliss: boolean;
  /** Extra lean of the upper body, degrees (+ = toward viewer-right). */
  lean: number;
  /** Forward dip (px) — e.g. pianist leaning into a big chord. */
  dip: number;
}

export interface Frame {
  s: MemberFrameState;
  /** Wall clock seconds. */
  t: number;
  dt: number;
  /** Follow matrix for this rig's front/back groups (already applied by the sprite). */
  M: Mat;
  arms: { L: ArmTarget; R: ArmTarget };
  look: Look;
}

export interface RigParts {
  back?: ReactNode;
  front: ReactNode;
  /** Things held in the paws (sticks, bows, mallets) — world coordinates, drawn between arms and paws. */
  held?: ReactNode;
}

export interface Rig {
  /** Which transform the instrument follows: fixed on stage, body sway, or the head (mouthpieces). */
  follow: "world" | "char" | "head";
  /** Seated / standing behind the instrument (feet hidden, no foot tap). */
  seated?: boolean;
  render(c: RigCtx): RigParts;
  update(c: RigCtx, f: Frame): void;
}

// ─── Shared motion helpers ───────────────────────────────────────────────────

/** 1 at the onset, decaying to 0. */
export const hit = (age: number, tau = 0.07) => (age < 0 ? 0 : Math.exp(-age / tau));

/** Damped wobble for cymbals/bars. */
export const wobble = (age: number, freq = 26, decay = 5) =>
  age < 0 || age > 2 ? 0 : Math.exp(-age * decay) * Math.sin(age * freq);

/**
 * Stick/mallet/hand lift envelope 0..1: rebounds after the last hit and
 * comes back down to land exactly on the next onset.
 */
export function strokeLift(lastAge: number, nextIn: number, rest = 0.6, win = 0.14): number {
  const rebound = lastAge === Infinity ? rest : Math.min(rest, (lastAge / 0.09) * rest);
  if (nextIn < win) return Math.min(rebound, (nextIn / win) * rest);
  return rebound;
}

/**
 * Track new onsets across frames. An onset's identity is its position on the
 * transport (beat - age), which stays fixed while playing and while paused,
 * so frozen or re-sent states never re-trigger. Calls fn(oldest → newest).
 */
export function newOnsets(
  c: RigCtx,
  f: Frame,
  fn: (o: { pitch: number; vel: number; age: number; chordSize: number }) => void,
) {
  const s = f.s;
  const bps = (s.bpm || 120) / 60;
  // Transport jumped backwards (restart / seek): forget what we've seen.
  if (c.mem.seenBeat !== undefined && s.beat < c.mem.seenBeat - 0.25) c.mem.lastOnsetBeat = -Infinity;
  c.mem.seenBeat = s.beat;
  const last = c.mem.lastOnsetBeat ?? -Infinity;
  const rec = s.recent;
  let newest = last;
  for (let i = rec.length - 1; i >= 0; i--) {
    const o = rec[i];
    if (o.age > 0.5) continue; // stale: never animate a stroke for something long gone
    const at = s.beat - o.age * bps;
    if (at > last + 0.01) {
      let chordSize = 0;
      for (const q of rec) if (Math.abs(q.age - o.age) < 0.02) chordSize++;
      fn({ ...o, chordSize });
      if (at > newest) newest = at;
    }
  }
  c.mem.lastOnsetBeat = newest;
}
