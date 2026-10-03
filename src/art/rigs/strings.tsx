// Bowed and plucked strings. String choice, hand position on the neck, bow
// direction and bow speed all come from the notes actually sounding.

import { L, S, ellipsePath, hash, mix } from "../sketch";
import { type Mat, type Pt, ap, approach, attr, chain, clamp, rot, scl, tr } from "../affine";
import { OPEN, stopFrac, stringFor } from "../fingering";
import { type Frame, type Rig, type RigCtx, hit, newOnsets } from "./types";

const WOOD = "#c0712f";
const WOOD_HATCH = "#e29a55";
const WOOD_INK = "#6b3a12";
const BOARD = "#2c2a35";
const STRING = "#efe6cf";
const HAIR = "#f6efdc";
const BOW = "#5a3418";

function norm(x: number, y: number): Pt {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function rotV(v: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
}

/** Newest sounding note (the one the hands care about), if any. */
function lead(f: Frame) {
  const a = f.s.active;
  if (!a.length) return null;
  let best = a[0];
  for (const n of a) if (n.age < best.age) best = n;
  return best;
}

// ─── Bowing (violin + cello) ─────────────────────────────────────────────────

interface BowGeo {
  open: number[];
  /** Local string coordinate across the strings (index → offset). */
  across: (i: number) => number;
  /** Contact point in local coords for string i. */
  contact: (i: number) => Pt;
  /** Left hand on the neck in local coords. */
  stop: (i: number, semis: number) => Pt;
  /** World bow direction (frog → tip) before string-crossing tilt. */
  bowDir: Pt;
  tilt: number; // degrees between outer strings
  bowLen: number;
  place: (c: RigCtx, f: Frame) => Mat;
}

function bowedUpdate(geo: BowGeo, c: RigCtx, f: Frame) {
  const m = c.mem;
  const local = geo.place(c, f);
  c.bag.tf("inst", attr(local));
  const W = chain(f.M, local);
  const n = lead(f);
  const next = f.s.nextOnsetIn < 0.12 ? f.s.nextPitch : null;
  const pitch = n ? n.pitch : next;
  const pos = pitch !== null ? stringFor(pitch, geo.open) : null;
  if (pos) {
    m.str = pos.string;
    m.semis = pos.semis;
  }
  const str = m.str ?? 1;
  m.strS = (m.strS ?? str) + (str - (m.strS ?? str)) * approach(f.dt, 0.05);

  // Bow: alternate direction per onset; travel ∝ note length.
  if (m.dir === undefined) {
    m.dir = 1;
    m.s0 = 0.3;
    m.bs = 0.3;
    m.travel = 0.4;
  }
  newOnsets(c, f, (o) => {
    m.dir = -m.dir;
    m.s0 = m.bs;
    const sounding = f.s.active.find((a) => a.pitch === o.pitch && Math.abs(a.age - o.age) < 0.03);
    const dur = sounding ? sounding.durSec : 0.4;
    m.travel = clamp(0.12 + dur * 0.32, 0.12, 0.85);
    // don't run off the bow: if it would, start the stroke from the other end
    if (m.dir > 0 && m.s0 + m.travel > 0.95) m.s0 = Math.max(0.05, 0.95 - m.travel);
    if (m.dir < 0 && m.s0 - m.travel < 0.05) m.s0 = Math.min(0.95, 0.05 + m.travel);
  });
  if (n) {
    const target = m.s0 + m.dir * m.travel * Math.min(1, n.progress * 1.05);
    m.bs = clamp(target, 0.04, 0.96);
  }
  const C = ap(W, geo.contact(0).x, geo.contact(0).y);
  const C3 = ap(W, geo.contact(3).x, geo.contact(3).y);
  const Cs = { x: C.x + (C3.x - C.x) * (m.strS / 3), y: C.y + (C3.y - C.y) * (m.strS / 3) };
  const u = rotV(geo.bowDir, geo.tilt * (m.strS / 3 - 0.5));
  // Lift the bow off the string when silent for a while.
  const quiet = !n && f.s.nextOnsetIn > 0.5;
  m.lift = (m.lift ?? 0) + ((quiet ? 1 : 0) - (m.lift ?? 0)) * approach(f.dt, 0.12);
  const perp = { x: u.y, y: -u.x };
  const off = { x: perp.x * m.lift * 7, y: perp.y * m.lift * 7 };
  const frog = { x: Cs.x - u.x * m.bs * geo.bowLen + off.x, y: Cs.y - u.y * m.bs * geo.bowLen + off.y };
  const tip = { x: frog.x + u.x * geo.bowLen, y: frog.y + u.y * geo.bowLen };
  c.bag.set("hair", "x1", frog.x);
  c.bag.set("hair", "y1", frog.y);
  c.bag.set("hair", "x2", tip.x);
  c.bag.set("hair", "y2", tip.y);
  c.bag.set("stick", "x1", frog.x + perp.x * 3);
  c.bag.set("stick", "y1", frog.y + perp.y * 3);
  c.bag.set("stick", "x2", tip.x + perp.x * 2);
  c.bag.set("stick", "y2", tip.y + perp.y * 2);
  c.bag.set("frog", "cx", frog.x + perp.x * 2);
  c.bag.set("frog", "cy", frog.y + perp.y * 2);

  // Left hand on the neck.
  const semis = m.semis ?? 2;
  m.semisS = (m.semisS ?? semis) + (semis - (m.semisS ?? semis)) * approach(f.dt, 0.035);
  const stop = geo.stop(Math.round(m.strS), m.semisS);
  const hand = ap(W, stop.x, stop.y);
  // vibrato on long notes
  const vib = n && n.durSec > 0.5 && n.progress > 0.2 ? Math.sin(f.t * 34) * 1.2 : 0;
  f.arms.R = { hand: { x: hand.x + vib, y: hand.y }, bend: -16, pawRot: -30 };
  f.arms.L = { hand: frog, bend: 18, pawRot: 10 };

  // String shimmer.
  for (let i = 0; i < 4; i++) {
    const on = n && Math.round(m.strS) === i;
    c.bag.tf("str" + i, on ? `translate(${(Math.sin(f.t * 97 + i) * 0.5).toFixed(2)} ${(Math.cos(f.t * 83) * 0.5).toFixed(2)})` : "");
    c.bag.op("str" + i, on ? 1 : 0.8);
  }
  f.look.bliss = !!n && n.durSec > 0.9 && n.progress > 0.2;
  f.look.lean = (m.bs - 0.5) * -4;
}

function bowParts(c: RigCtx) {
  return (
    <g>
      <line ref={c.bag.r("hair")} stroke={HAIR} strokeWidth={2.2} strokeLinecap="round" />
      <line ref={c.bag.r("stick")} stroke={BOW} strokeWidth={2} strokeLinecap="round" />
      <circle ref={c.bag.r("frog")} r={3.2} fill="#2c2a35" />
    </g>
  );
}

// Violin: body centre local origin, neck along +x.
const VIOLIN: BowGeo = {
  open: OPEN.violin,
  across: (i) => 2.4 - i * 1.6,
  contact: (i) => ({ x: -17, y: 2.4 - i * 1.6 }),
  stop: (i, semis) => ({ x: 63 - 77 * stopFrac(semis), y: 2.4 - i * 1.6 + 6 }),
  bowDir: norm(1, 0.25),
  tilt: -16,
  bowLen: 98,
  place: (c, f) => {
    const m = c.mem;
    const sway = Math.sin(f.t * 1.4) * (f.s.active.length ? 2 : 0.6);
    return chain(tr(c.mouth.x + 30, c.mouth.y + 18), rot(-28 + sway + (m.strS ?? 1) * 0.8), scl(1.18));
  },
};

export const violin: Rig = {
  follow: "head",
  render(c) {
    const s = hash(c.animal + "vln");
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <S
            d="M-30 0 C-30 -17 -14 -18 -8 -12 C-4 -9 4 -9 8 -12 C14 -16 28 -15 28 0 C28 15 14 16 8 12 C4 9 -4 9 -8 12 C-14 18 -30 17 -30 0 Z"
            ink={WOOD_INK}
            base={mix(WOOD, "#fff", 0.25)}
            hatch={WOOD_HATCH}
            seed={s}
            gap={2.8}
          />
          <L d="M-11 -7 q2 2 0 4 q-2 2 0 4 M-11 3 q2 2 0 4" ink={WOOD_INK} seed={s + 1} w={1.1} />
          <S d={ellipsePath(-26, 7, 5, 3.5)} ink="#1f1c26" base="#3b3446" seed={s + 2} w={1} />
          <path d="M-4 -3.4 L63 -2.6 L63 2.6 L-4 3.4 Z" fill={BOARD} />
          <path d="M-24 -2 L-20 -4 L-20 4 L-24 2 Z" fill={BOARD} />
          <path d="M-14 -5 V5" stroke={WOOD_INK} strokeWidth={1.6} />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} ref={c.bag.r("str" + i)} d={`M-22 ${VIOLIN.across(i)} H63`} stroke={STRING} strokeWidth={0.7} />
          ))}
          <S d="M63 -3 H70 V3 H63 Z" ink={WOOD_INK} base={WOOD} seed={s + 3} w={1.1} />
          <S d={ellipsePath(73, 0, 4.2, 4.2)} ink={WOOD_INK} base={WOOD} seed={s + 4} w={1.2} />
        </g>
      ),
      held: bowParts(c),
    };
  },
  update: (c, f) => bowedUpdate(VIOLIN, c, f),
};

// Cello: body centre local origin, neck along −y. Seated, stands on the floor.
const CELLO: BowGeo = {
  open: OPEN.cello,
  across: (i) => -3.3 + i * 2.2,
  contact: (i) => ({ x: -3.3 + i * 2.2, y: 6 }),
  stop: (i, semis) => ({ x: -3.3 + i * 2.2 + 7, y: -120 + 132 * stopFrac(semis) }),
  bowDir: norm(1, 0.12),
  tilt: 14,
  bowLen: 98,
  place: (c, f) => chain(tr(160, 196), rot(11 + Math.sin(f.t * 1.1) * (f.s.active.length ? 1 : 0.3))),
};

export const cello: Rig = {
  follow: "world",
  seated: true,
  render(c) {
    const s = hash(c.animal + "vc");
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <path d="M0 46 V52" stroke="#6d6a75" strokeWidth={2.4} strokeLinecap="round" />
          <S
            d="M0 -44 C-16 -44 -24 -36 -22 -24 C-20 -16 -14 -14 -15 -6 C-16 2 -28 6 -28 22 C-28 38 -14 46 0 46 C14 46 28 38 28 22 C28 6 16 2 15 -6 C14 -14 20 -16 22 -24 C24 -36 16 -44 0 -44 Z"
            ink={WOOD_INK}
            base={mix(WOOD, "#fff", 0.2)}
            hatch={WOOD_HATCH}
            seed={s}
            gap={3}
          />
          <L d="M-10 -8 q-3 6 0 12 q3 6 0 12 M10 -8 q3 6 0 12 q-3 6 0 12" ink={WOOD_INK} seed={s + 1} w={1.2} />
          <path d="M-4.5 0 L-3.5 -122 L3.5 -122 L4.5 0 Z" fill={BOARD} />
          <path d="M-4 30 L4 30 L3 40 L-3 40 Z" fill={BOARD} />
          <path d="M-8 14 H8" stroke={WOOD_INK} strokeWidth={1.8} />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} ref={c.bag.r("str" + i)} d={`M${CELLO.across(i)} 32 V-121`} stroke={STRING} strokeWidth={0.8} />
          ))}
          <S d="M-4 -122 H4 V-132 H-4 Z" ink={WOOD_INK} base={WOOD} seed={s + 2} w={1.1} />
          <S d={ellipsePath(0, -136, 4.5, 4.5)} ink={WOOD_INK} base={WOOD} seed={s + 3} w={1.2} />
        </g>
      ),
      held: bowParts(c),
    };
  },
  update: (c, f) => bowedUpdate(CELLO, c, f),
};

// ─── Upright bass (pizzicato) ────────────────────────────────────────────────

const BASS_X = (i: number) => -4.2 + i * 2.8;
const BASS_NUT = -150;
const BASS_BRIDGE = 14;

export const bass: Rig = {
  follow: "world",
  render(c) {
    const s = hash(c.animal + "cb");
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <path d="M0 58 V64" stroke="#6d6a75" strokeWidth={2.6} strokeLinecap="round" />
          <S
            d="M0 -58 C-20 -58 -30 -48 -28 -32 C-26 -22 -18 -18 -19 -8 C-20 2 -36 8 -36 30 C-36 50 -18 58 0 58 C18 58 36 50 36 30 C36 8 20 2 19 -8 C18 -18 26 -22 28 -32 C30 -48 20 -58 0 -58 Z"
            ink={WOOD_INK}
            base={mix("#9a5424", "#fff", 0.2)}
            hatch="#c27a3d"
            seed={s}
            gap={3}
          />
          <L d="M-13 -10 q-4 8 0 16 q4 8 0 16 M13 -10 q4 8 0 16 q-4 8 0 16" ink={WOOD_INK} seed={s + 1} w={1.3} />
          <path d="M-5.5 -2 L-4 -152 L4 -152 L5.5 -2 Z" fill={BOARD} />
          <path d="M-5 38 L5 38 L4 50 L-4 50 Z" fill={BOARD} />
          <path d="M-10 14 H10" stroke={WOOD_INK} strokeWidth={2} />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} ref={c.bag.r("str" + i)} d={`M${BASS_X(i)} 40 V-151`} stroke={STRING} strokeWidth={1} />
          ))}
          <S d="M-5 -152 H5 V-164 H-5 Z" ink={WOOD_INK} base="#9a5424" seed={s + 2} w={1.1} />
          <S d={ellipsePath(0, -168, 5, 5)} ink={WOOD_INK} base="#9a5424" seed={s + 3} w={1.2} />
        </g>
      ),
    };
  },
  update(c, f) {
    const m = c.mem;
    const local = chain(tr(172, 192), rot(9 + Math.sin(f.t * 1.2) * 0.5), scl(0.86));
    c.bag.tf("inst", attr(local));
    const W = chain(f.M, local);
    const n = lead(f);
    const next = f.s.nextOnsetIn < 0.15 ? f.s.nextPitch : null;
    const pitch = next ?? (n ? n.pitch : null);
    if (pitch !== null) {
      const p = stringFor(pitch, OPEN.bass);
      m.str = p.string;
      m.semis = p.semis;
    }
    const str = m.str ?? 1;
    m.semisS = (m.semisS ?? 3) + ((m.semis ?? 3) - (m.semisS ?? 3)) * approach(f.dt, 0.03);
    const last = f.s.recent[0];
    const age = last ? last.age : Infinity;
    // Pluck: finger rests on the string, pulls through on the onset, then drifts back.
    const pull = age < 0.12 ? Math.sin((age / 0.12) * (Math.PI / 2)) : Math.exp(-(age - 0.12) / 0.12);
    const ready = f.s.nextOnsetIn < 0.15 ? 1 - f.s.nextOnsetIn / 0.15 : 0;
    const flick = Math.max(0, pull * (1 - ready)) * 12;
    const pluckLocal = { x: BASS_X(str) - 3 + flick, y: -16 + flick * 0.3 };
    f.arms.L = { hand: ap(W, pluckLocal.x, pluckLocal.y), bend: 16, pawRot: 60 };
    const stopY = BASS_NUT + (BASS_BRIDGE - BASS_NUT) * stopFrac(m.semisS);
    f.arms.R = { hand: ap(W, BASS_X(str) + 8, stopY), bend: -18, pawRot: -40 };
    for (let i = 0; i < 4; i++) {
      const ring = age < 1.2 && i === str ? hit(age, 0.35) : 0;
      c.bag.tf("str" + i, ring > 0.02 ? `translate(${(Math.sin(f.t * 70) * ring * 1.6).toFixed(2)} 0)` : "");
    }
    f.look.lean = 2 + hit(age, 0.2) * 1.5;
    f.look.dip = hit(age, 0.15) * 1.5;
  },
};

// ─── Guitar ──────────────────────────────────────────────────────────────────

const GTR_Y = (i: number) => 3.75 - i * 1.5;
const GTR_NUT = 104;
const GTR_BRIDGE = -30;

export const guitar: Rig = {
  follow: "char",
  render(c) {
    const s = hash(c.animal + "gtr");
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <S
            d="M-44 0 C-44 -24 -22 -26 -12 -18 C-6 -14 -2 -14 4 -16 C14 -22 28 -18 28 0 C28 18 14 22 4 16 C-2 14 -6 14 -12 18 C-22 26 -44 24 -44 0 Z"
            ink={WOOD_INK}
            base="#f3cf8e"
            hatch="#d9a65a"
            seed={s}
            gap={3.2}
          />
          <S d={ellipsePath(4, 0, 7, 7)} ink="#3b2a1a" base="#3b2a1a" seed={s + 1} w={1.2} />
          <path d="M26 -4.2 L104 -3.4 L104 3.4 L26 4.2 Z" fill="#6b3a12" />
          <path d={Array.from({ length: 10 }, (_, i) => `M${(GTR_NUT - 134 * stopFrac(i + 1)).toFixed(1)} -3.8 v7.6`).join(" ")} stroke="#c9c5d6" strokeWidth={0.8} />
          <path d="M-32 -6 h5 v12 h-5 Z" fill="#3b2a1a" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} ref={c.bag.r("str" + i)} d={`M-30 ${GTR_Y(i)} H104`} stroke={STRING} strokeWidth={0.6} />
          ))}
          <S d="M104 -5 L122 -7 L122 7 L104 5 Z" ink={WOOD_INK} base="#9a5424" seed={s + 2} w={1.1} />
        </g>
      ),
    };
  },
  update(c, f) {
    const m = c.mem;
    const local = chain(tr(108, 198), rot(-20));
    c.bag.tf("inst", attr(local));
    const W = chain(f.M, local);
    if (m.sdir === undefined) {
      m.sdir = 1;
      m.sT = -Infinity;
      m.pT = -Infinity;
      m.pStr = 2;
    }
    newOnsets(c, f, (o) => {
      const T = f.t - o.age;
      if (o.chordSize >= 2) {
        if (T - m.sT > 0.03) {
          m.sdir = -m.sdir;
          m.sT = T;
        }
      } else {
        m.pT = T;
        m.pStr = stringFor(o.pitch, OPEN.guitar).string;
      }
    });
    // Fretting hand: average fret of what's sounding (or about to).
    const pitches = f.s.active.length ? f.s.active.map((a) => a.pitch) : f.s.nextOnsetIn < 0.12 && f.s.nextPitch !== null ? [f.s.nextPitch] : [];
    if (pitches.length) {
      let sum = 0;
      for (const p of pitches) sum += Math.min(stringFor(p, OPEN.guitar).semis, 12);
      m.fret = sum / pitches.length;
    }
    m.fretS = (m.fretS ?? 3) + ((m.fret ?? 3) - (m.fretS ?? 3)) * approach(f.dt, 0.04);
    const fx = GTR_NUT - (GTR_NUT - GTR_BRIDGE) * stopFrac(Math.max(0.5, m.fretS));
    f.arms.R = { hand: ap(W, fx, 7), bend: -14, pawRot: -30 };

    const sAge = f.t - m.sT;
    const pAge = f.t - m.pT;
    let hy: number;
    let hx = -10;
    if (sAge <= pAge) {
      const k = clamp(sAge / 0.085, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      hy = m.sdir > 0 ? -16 + 32 * e : 16 - 32 * e;
    } else {
      const flick = hit(pAge, 0.06);
      hy = GTR_Y(m.pStr) + 2 + flick * 4;
      hx = -10 + flick * 3;
    }
    f.arms.L = { hand: ap(W, hx, hy), bend: 16, pawRot: 40 };
    for (let i = 0; i < 6; i++) {
      const ring = f.s.active.length && Math.min(sAge, pAge) < 1.5 ? hit(Math.min(sAge, pAge), 0.3) : 0;
      c.bag.tf("str" + i, ring > 0.03 ? `translate(0 ${(Math.sin(f.t * 90 + i) * ring * 0.6).toFixed(2)})` : "");
    }
    f.look.lean = -2 + Math.sin(f.t * 1.3) * (f.s.active.length ? 1.5 : 0.5);
    f.look.bliss = f.s.featured && f.s.active.some((a) => a.durSec > 0.8);
  },
};
