// Wind instruments: the mouthpiece rides on the head; fingerings, slide and
// valves are derived from the pitch actually sounding.

import type { ReactNode } from "react";
import { S, ellipsePath, hash, mix } from "../sketch";
import { type Mat, ap, approach, attr, chain, clamp, rot, scl, tr } from "../affine";
import { clarinet, tromboneSlide, trumpetValves, woodwind, type WoodwindFingering } from "../fingering";
import type { Frame, Rig, RigCtx } from "./types";

const BRASS = "#f2c14e";
const BRASS_HATCH = "#d9a12e";
const BRASS_INK = "#8a6418";
const PEARL = "#fffaf0";

function NoteGlyph({ ink }: { ink: string }) {
  return (
    <g>
      <ellipse cx={0} cy={0} rx={3.2} ry={2.4} transform="rotate(-20)" fill={ink} />
      <path d="M2.8 -0.8 V-11 q3.8 1.6 4.6 5.6" stroke={ink} strokeWidth={1.4} fill="none" strokeLinecap="round" />
    </g>
  );
}

function puffs(c: RigCtx): ReactNode {
  return [0, 1, 2].map((i) => (
    <g key={i} ref={c.bag.r("puff" + i)} style={{ opacity: 0 }}>
      <NoteGlyph ink={i === 1 ? c.ink : "#2c2a35"} />
    </g>
  ));
}

/** Little note doodles drifting out of the bell, one per recent onset. */
function updatePuffs(c: RigCtx, f: Frame, bell: { x: number; y: number }, dir: { x: number; y: number }, lowered: number) {
  for (let i = 0; i < 3; i++) {
    const o = f.s.recent[i];
    if (!o || o.age > 1.2 || lowered > 0.5) {
      c.bag.op("puff" + i, 0);
      continue;
    }
    const a = o.age;
    const x = bell.x + dir.x * (8 + a * 38) + Math.sin(a * 7 + i) * 3;
    const y = bell.y + dir.y * (8 + a * 38) - a * 26;
    c.bag.tf("puff" + i, `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(0.7 + a * 0.4).toFixed(2)})`);
    c.bag.op("puff" + i, Math.max(0, 1 - a / 1.2) * (0.5 + o.vel * 0.5));
  }
}

interface Wind {
  blowing: boolean;
  pitch: number | null;
  lowered: number;
}

/** Shared breathing / cheeks / rest posture logic. */
function windCommon(c: RigCtx, f: Frame): Wind {
  const { s } = f;
  const m = c.mem;
  const blowing = s.active.length > 0;
  // the newest sounding note (active is newest first) is the one being fingered
  const pitch = blowing ? s.active[0].pitch : s.nextOnsetIn < 0.06 ? s.nextPitch : null;
  const quiet = !blowing && s.nextOnsetIn > 1.4 && (s.recent[0]?.age ?? Infinity) > 0.8;
  const lowerTarget = !s.playing ? (quiet ? 0.75 : 0) : quiet && (s.role === "rest" || s.nextOnsetIn > 3) ? 1 : 0;
  m.lower = (m.lower ?? 0.75) + (lowerTarget - (m.lower ?? 0.75)) * approach(f.dt, lowerTarget > (m.lower ?? 0) ? 0.35 : 0.12);
  m.cheek = (m.cheek ?? 0) + ((blowing ? 1 : 0) - (m.cheek ?? 0)) * approach(f.dt, blowing ? 0.04 : 0.1);
  f.look.mouthCovered = m.lower < 0.55;
  f.look.cheeks = m.cheek * (1 - m.lower);
  f.look.inhale = !blowing && s.nextOnsetIn < 0.45 ? 1 - s.nextOnsetIn / 0.45 : 0;
  f.look.bliss = s.active.some((n) => n.durSec > 0.9 && n.progress > 0.25) || (s.featured && blowing && s.active[0].durSec > 0.5);
  return { blowing, pitch, lowered: m.lower };
}

function keyDot(c: RigCtx, key: string, x: number, y: number, r = 3) {
  return <circle key={key} ref={c.bag.r(key)} cx={x} cy={y} r={r} fill={PEARL} stroke="#2c2a35" strokeWidth={1.1} />;
}

function setKeys(c: RigCtx, fg: WoodwindFingering | null, ink: string) {
  for (let i = 0; i < 6; i++) c.bag.set("k" + i, "fill", fg && fg.holes[i] ? ink : PEARL);
  c.bag.set("kp", "fill", fg && fg.pinky ? ink : PEARL);
  c.bag.set("ko", "fill", fg && fg.octave ? ink : PEARL);
}

function placeInst(c: RigCtx, f: Frame, local: Mat) {
  c.bag.tf("inst", attr(local));
  return (x: number, y: number) => ap(chain(f.M, local), x, y);
}

// ─── Trumpet ─────────────────────────────────────────────────────────────────

export const trumpet: Rig = {
  follow: "head",
  render(c) {
    const s = hash(c.animal + "tpt");
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <S d="M30 6 Q26 18 40 18 H58 Q66 18 64 8" ink={BRASS_INK} seed={s} w={2.4} />
          <S d="M0 -2 H82 V2 H0 Z" ink={BRASS_INK} base={BRASS} seed={s + 1} w={1.6} />
          <S d="M80 -3 Q94 -5 104 -17 L104 17 Q94 5 80 3 Z" ink={BRASS_INK} base={BRASS} hatch={BRASS_HATCH} seed={s + 2} gap={3} />
          <S d={ellipsePath(104, 0, 3.5, 17)} ink={BRASS_INK} base={mix(BRASS, "#fff", 0.4)} seed={s + 3} w={1.5} />
          <S d="M-2 -3 H8 V3 H-2 Z" ink="#6d6a75" base="#d8d8e0" seed={s + 4} w={1.2} />
          {[36, 44, 52].map((x, i) => (
            <g key={i}>
              <S d={`M${x} -12 h6 v24 h-6 Z`} ink={BRASS_INK} base={BRASS} hatch={BRASS_HATCH} seed={s + 5 + i} gap={2.5} w={1.4} />
              <g ref={c.bag.r("v" + i)}>
                <path d={`M${x + 3} -12 V-17`} stroke={BRASS_INK} strokeWidth={1.6} />
                <S d={ellipsePath(x + 3, -18, 4, 2.4)} ink={BRASS_INK} base={PEARL} seed={s + 9 + i} w={1.2} />
              </g>
            </g>
          ))}
          {puffs(c)}
        </g>
      ),
    };
  },
  update(c, f) {
    const w = windCommon(c, f);
    const m = c.mem;
    const tilt = w.pitch !== null ? -8 - clamp(w.pitch - 67, -12, 16) * 0.55 : -6;
    m.tilt = (m.tilt ?? -6) + (tilt - (m.tilt ?? -6)) * approach(f.dt, 0.12);
    const lw = w.lowered;
    const local = chain(tr(c.mouth.x + lw * 4, c.mouth.y + lw * 26), rot(m.tilt + lw * 38), scl(1.12));
    const toWorld = placeInst(c, f, local);
    const valves = w.pitch !== null ? trumpetValves(w.pitch) : [false, false, false];
    valves.forEach((down, i) => c.bag.tf("v" + i, down ? "translate(0 4)" : ""));
    updatePuffs(c, f, { x: 106, y: 0 }, { x: 1, y: -0.2 }, lw);
    const pressDepth = valves.filter(Boolean).length;
    // Right paw rests behind the valve block so the caps (and their presses) stay visible.
    f.arms.R = { hand: toWorld(62, -8 + pressDepth * 0.6), bend: -14, pawRot: -10 };
    f.arms.L = { hand: toWorld(38, 13), bend: 16, pawRot: 30 };
    f.look.lean = (w.blowing ? 2 : 0) - (m.tilt + 6) * 0.15;
  },
};

// ─── Trombone ────────────────────────────────────────────────────────────────

const SLIDE_STEP = 10.5;

export const trombone: Rig = {
  follow: "head",
  render(c) {
    const s = hash(c.animal + "tbn");
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          {/* bell section, sits above the slide */}
          <S d="M4 -12 H44 V-8 H4 Z" ink={BRASS_INK} base={BRASS} seed={s} w={1.4} />
          <S d="M-4 -12 Q-10 -6 -4 0" ink={BRASS_INK} seed={s + 1} w={2.4} />
          <S d="M42 -13 Q56 -14 70 -28 L70 6 Q56 -6 42 -7 Z" ink={BRASS_INK} base={BRASS} hatch={BRASS_HATCH} seed={s + 2} gap={3} />
          <S d={ellipsePath(70, -11, 3.5, 17)} ink={BRASS_INK} base={mix(BRASS, "#fff", 0.4)} seed={s + 3} w={1.5} />
          {/* inner slide (fixed) */}
          <path d="M0 0 H66 M0 9 H66" stroke={BRASS_INK} strokeWidth={2.2} />
          <S d="M-2 -3 H8 V3 H-2 Z" ink="#6d6a75" base="#d8d8e0" seed={s + 4} w={1.2} />
          {/* outer slide (moves) */}
          <g ref={c.bag.r("slide")}>
            <path d="M30 0 H96 M30 9 H96" stroke={BRASS_INK} strokeWidth={4.2} strokeLinecap="round" />
            <path d="M30 0 H96 M30 9 H96" stroke={BRASS} strokeWidth={2.2} strokeLinecap="round" />
            <S d="M96 -1 Q104 4.5 96 10" ink={BRASS_INK} seed={s + 5} w={2.6} />
            <path d="M58 0 V9" stroke={BRASS_INK} strokeWidth={2} />
          </g>
          {puffs(c)}
        </g>
      ),
    };
  },
  update(c, f) {
    const w = windCommon(c, f);
    const m = c.mem;
    const pos = w.pitch !== null ? tromboneSlide(w.pitch) : m.pos ?? 1;
    if (w.pitch !== null) m.pos = pos;
    m.slide = (m.slide ?? 0) + ((pos - 1) * SLIDE_STEP - (m.slide ?? 0)) * approach(f.dt, 0.045);
    c.bag.tf("slide", `translate(${m.slide.toFixed(2)} 0)`);
    const lw = w.lowered;
    const local = chain(tr(c.mouth.x + lw * 2, c.mouth.y + lw * 30), rot(6 + lw * 40));
    const toWorld = placeInst(c, f, local);
    updatePuffs(c, f, { x: 72, y: -11 }, { x: 1, y: -0.3 }, lw);
    f.arms.R = { hand: toWorld(58 + m.slide, 5), bend: -10, pawRot: -20 };
    f.arms.L = { hand: toWorld(22, -6), bend: 18, pawRot: 20 };
    f.look.lean = w.blowing ? 1.5 + m.slide * 0.03 : 0;
  },
};

// ─── Saxophone (tenor) ───────────────────────────────────────────────────────

const SAX_KEYS: [number, number][] = [
  [32, 38],
  [33, 48],
  [34, 58],
  [34.5, 72],
  [35.3, 82],
  [36, 92],
];

export const sax: Rig = {
  follow: "head",
  render(c) {
    const s = hash(c.animal + "sax");
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <S d="M-2 -3 Q14 -4 26 8 Q32 14 32 22 L26 24 Q24 16 18 10 Q10 3 -2 3 Z" ink={BRASS_INK} base={BRASS} seed={s} w={1.5} />
          <S d="M-4 -2.5 H6 V2.5 H-4 Z" ink="#2c2a35" base="#3b3446" seed={s + 1} w={1.2} />
          <S d="M26 22 L29 98 Q32 118 48 118 Q64 118 66 98 L74 66 L82 57 L54 60 L58 74 L55 96 Q53 103 49 103 Q45 103 44 96 L36 22 Z" ink={BRASS_INK} base={BRASS} hatch={BRASS_HATCH} seed={s + 2} gap={3} />
          <g transform="rotate(-6 68 58.5)">
            <S d={ellipsePath(68, 58.5, 14.5, 4.5)} ink={BRASS_INK} base={mix(BRASS, "#3b3446", 0.35)} seed={s + 3} w={1.4} />
          </g>
          {SAX_KEYS.map(([x, y], i) => keyDot(c, "k" + i, x, y))}
          {keyDot(c, "ko", 27.5, 30, 2.2)}
          {keyDot(c, "kp", 41, 88, 2.4)}
          {puffs(c)}
        </g>
      ),
    };
  },
  update(c, f) {
    const w = windCommon(c, f);
    const lw = w.lowered;
    const sway = Math.sin(f.t * 1.5) * (w.blowing ? 3 : 1) * (f.s.featured ? 1.6 : 1);
    const local = chain(tr(c.mouth.x + lw * 6, c.mouth.y + lw * 10), rot(sway * 0.6 + lw * 10));
    const toWorld = placeInst(c, f, local);
    const fg = w.pitch !== null ? woodwind(w.pitch + 14, 74) : null;
    setKeys(c, fg, c.ink);
    updatePuffs(c, f, { x: 68, y: 56 }, { x: 0.25, y: -1 }, lw);
    const upperDown = fg ? fg.holes.slice(0, 3).filter(Boolean).length : 0;
    const lowerDown = fg ? fg.holes.slice(3).filter(Boolean).length : 0;
    // Upper stack from across the chest, lower stack straight down.
    f.arms.L = { hand: toWorld(31 - upperDown * 0.6, 48), bend: 8, pawRot: 70 };
    f.arms.R = { hand: toWorld(40 + lowerDown * 0.6, 84), bend: 10, pawRot: -60 };
    f.look.lean = sway;
  },
};

// ─── Clarinet ────────────────────────────────────────────────────────────────

const CL_KEYS: [number, number][] = [
  [0, 26],
  [0, 36],
  [0, 46],
  [0, 64],
  [0, 74],
  [0, 84],
];

export const clarinetRig: Rig = {
  follow: "head",
  render(c) {
    const s = hash(c.animal + "cl");
    const wood = "#3b3446";
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <S d="M-3 0 L3 0 L4 98 L-4 98 Z" ink="#1f1c26" base={wood} hatch="#6a5f7d" seed={s} gap={3} />
          <S d="M-4 96 Q-6 108 -12 116 L12 116 Q6 108 4 96 Z" ink="#1f1c26" base={wood} hatch="#6a5f7d" seed={s + 1} gap={3} />
          <path d="M-4 18 H4 M-4 56 H4 M-4.5 94 H4.5" stroke="#c9c5d6" strokeWidth={2} />
          <S d="M-2 -6 L2 -6 L3 2 L-3 2 Z" ink="#1f1c26" base="#2c2a35" seed={s + 2} w={1} />
          {CL_KEYS.map(([x, y], i) => keyDot(c, "k" + i, x, y, 2.6))}
          {keyDot(c, "ko", -5, 22, 1.8)}
          {keyDot(c, "kp", 5, 90, 1.8)}
          {puffs(c)}
        </g>
      ),
    };
  },
  update(c, f) {
    const w = windCommon(c, f);
    const lw = w.lowered;
    const sway = Math.sin(f.t * 1.3) * (w.blowing ? 2.5 : 0.8) * (f.s.featured ? 1.6 : 1);
    // Higher notes: the bell lifts a little, like players do.
    const m = c.mem;
    const lift = w.pitch !== null ? clamp((w.pitch - 70) * 0.5, -4, 10) : 0;
    m.cl = (m.cl ?? 0) + (lift - (m.cl ?? 0)) * approach(f.dt, 0.2);
    const local = chain(tr(c.mouth.x, c.mouth.y + 2 + lw * 8), rot(-16 - m.cl - lw * 18 + sway));
    const toWorld = placeInst(c, f, local);
    setKeys(c, w.pitch !== null ? clarinet(w.pitch + 2) : null, "#2c2a35");
    updatePuffs(c, f, { x: 0, y: 118 }, { x: 0.3, y: 1 }, lw);
    f.arms.R = { hand: toWorld(4, 38), bend: -14, pawRot: -80 };
    f.arms.L = { hand: toWorld(4, 76), bend: 16, pawRot: -80 };
    f.look.lean = sway * 0.8;
  },
};

// ─── Flute ───────────────────────────────────────────────────────────────────

const FL_KEYS: [number, number][] = [
  [-30, -3],
  [-38, -3],
  [-46, -3],
  [-62, -3],
  [-70, -3],
  [-78, -3],
];

export const flute: Rig = {
  follow: "head",
  render(c) {
    const s = hash(c.animal + "fl");
    const silver = "#e3e2ea";
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <S d="M16 -3 L-98 -3 L-98 3 L16 3 Z" ink="#5d5870" base={silver} hatch="#b9b6c8" seed={s} gap={3} w={1.4} />
          <path d="M-14 -3.4 V3.4 M-52 -3.4 V3.4 M-88 -3.4 V3.4" stroke="#8f8aa3" strokeWidth={1.2} />
          <ellipse cx={0} cy={-3} rx={2.6} ry={1.4} fill="#2c2a35" />
          {FL_KEYS.map(([x, y], i) => keyDot(c, "k" + i, x, y, 2.6))}
          {keyDot(c, "ko", -20, -3, 1.8)}
          {keyDot(c, "kp", -86, -3, 1.8)}
          {puffs(c)}
        </g>
      ),
    };
  },
  update(c, f) {
    const w = windCommon(c, f);
    const lw = w.lowered;
    const m = c.mem;
    const tilt = w.pitch !== null ? clamp((w.pitch - 78) * 0.25, -4, 5) : 0;
    m.ft = (m.ft ?? 0) + (tilt - (m.ft ?? 0)) * approach(f.dt, 0.2);
    const sway = Math.sin(f.t * 1.2) * (w.blowing ? 2 : 0.6);
    const local = chain(tr(c.mouth.x + 2, c.mouth.y + 1 + lw * 22), rot(-10 + m.ft + sway - lw * 25));
    const toWorld = placeInst(c, f, local);
    setKeys(c, w.pitch !== null ? woodwind(w.pitch, 74) : null, c.ink);
    updatePuffs(c, f, { x: -100, y: 0 }, { x: -1, y: -0.3 }, lw);
    f.arms.R = { hand: toWorld(-38, 5), bend: -12, pawRot: 0 };
    f.arms.L = { hand: toWorld(-70, 5), bend: 16, pawRot: 0 };
    f.look.lean = -2 + sway;
  },
};
