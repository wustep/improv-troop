// Bowed and plucked strings. String choice, hand position on the neck, bow
// direction and bow speed all come from the notes actually sounding.

import { L, S, ellipsePath, hash, mix } from "../sketch";
import { type Mat, type Pt, ap, approach, attr, chain, clamp, rot, scl, tr } from "../affine";
import { OPEN, stopFrac, stringFor } from "../fingering";
import { type Frame, type Rig, type RigCtx, hit, newOnsets, slewTo } from "./types";

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
/** The newest sounding note; of a chord struck together, the longest, which carries the bow stroke. */
function lead(f: Frame) {
  return longestOf(f.s.active.filter((n) => n.age - Math.min(...f.s.active.map((a) => a.age)) < 0.03));
}

/**
 * The longest of notes struck together. A double- or triple-stop's notes can end at different
 * times; the bow follows the one still sounding to the end, or it jumps when a short one stops.
 */
function longestOf<T extends { durSec: number }>(notes: T[]): T | null {
  let best: T | null = null;
  for (const n of notes) if (!best || n.durSec > best.durSec) best = n;
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
  /** Where the bowing hand plucks string i (pizz), in local coords. */
  pluck: (i: number) => Pt;
  /** World direction the tucked bow points while plucking. */
  park: Pt;
  place: (c: RigCtx, f: Frame) => Mat;
}

/**
 * The next bow stroke from bow position `at` (0 frog … 1 tip): the alternating direction `dir`,
 * using as much of `want` as the bow has left that way. With almost none left, it keeps the
 * direction that has room instead. The stroke always starts where the bow is: jumping to the
 * other end for a long note teleported the bow arm in one frame.
 */
export function nextStroke(at: number, dir: number, want: number): [number, number] {
  const room = (d: number) => (d > 0 ? 0.95 - at : at - 0.05);
  const d = room(dir) >= Math.min(want, 0.2) ? dir : -dir;
  return [d, clamp(Math.min(want, room(d)), 0.04, 0.85)];
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
  if (m.pluckT === undefined) m.pluckT = -Infinity;
  newOnsets(c, f, (o) => {
    // a plucked note doesn't move the bow
    if (o.art === "pizz") {
      m.pluckT = f.t - o.age;
      return;
    }
    const sounding = longestOf(f.s.active.filter((a) => Math.abs(a.age - o.age) < 0.03));
    const dur = sounding ? sounding.durSec : 0.4;
    m.s0 = m.bs;
    [m.dir, m.travel] = nextStroke(m.bs, -m.dir, clamp(0.12 + dur * 0.32, 0.12, 0.85));
  });
  // Pizz or arco? Follow the newest note (or the most recent onset).
  const lastArt = n?.art ?? f.s.recent[0]?.art;
  const pizzNow = lastArt === "pizz" && (!!n || (f.s.recent[0]?.age ?? Infinity) < 1.5);
  m.pz = (m.pz ?? 0) + ((pizzNow ? 1 : 0) - (m.pz ?? 0)) * approach(f.dt, pizzNow ? 0.06 : 0.18);
  const pz = m.pz;
  if (n && n.art !== "pizz") {
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
  const perp0 = { x: u.y, y: -u.x };
  const off = { x: perp0.x * m.lift * 7, y: perp0.y * m.lift * 7 };
  const arcoFrog = { x: Cs.x - u.x * m.bs * geo.bowLen + off.x, y: Cs.y - u.y * m.bs * geo.bowLen + off.y };
  // pizz: the bowing hand plucks at the end of the fingerboard, the bow tucked in its palm
  const pAge = f.t - m.pluckT;
  const pull = pAge < 0.1 ? Math.sin((pAge / 0.1) * (Math.PI / 2)) : Math.exp(-(pAge - 0.1) / 0.12);
  const ready = f.s.nextOnsetIn < 0.15 ? 1 - f.s.nextOnsetIn / 0.15 : 0;
  const flick = Math.max(0, pull * (1 - ready)) * 5;
  const pl = geo.pluck(Math.round(m.strS));
  const pluck = ap(W, pl.x, pl.y + flick);
  const bowHand = { x: arcoFrog.x + (pluck.x - arcoFrog.x) * pz, y: arcoFrog.y + (pluck.y - arcoFrog.y) * pz };
  const dn = norm(u.x + (geo.park.x - u.x) * pz, u.y + (geo.park.y - u.y) * pz);
  const perp = { x: dn.y, y: -dn.x };
  const frog = { x: bowHand.x - dn.x * 4 * pz, y: bowHand.y - dn.y * 4 * pz };
  const tip = { x: frog.x + dn.x * geo.bowLen, y: frog.y + dn.y * geo.bowLen };
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
  f.arms.L = { hand: bowHand, bend: 18, pawRot: 10 + pz * 40 };

  // String shimmer.
  for (let i = 0; i < 4; i++) {
    const on = n && Math.round(m.strS) === i;
    c.bag.tf("str" + i, on ? `translate(${(Math.sin(f.t * 97 + i) * 0.5).toFixed(2)} ${(Math.cos(f.t * 83) * 0.5).toFixed(2)})` : "");
    c.bag.op("str" + i, on ? 1 : 0.8);
  }
  f.look.bliss = !!n && n.durSec > 0.9 && n.progress > 0.2;
  f.look.lean = (m.bs - 0.5) * -4 * (1 - pz);
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
  pluck: (i) => ({ x: 0, y: 2.4 - i * 1.6 }),
  park: norm(-0.86, 0.5),
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

// ─── Cello ───────────────────────────────────────────────────────────────────
//
// Seated on a stool, the cello stands between the knees on its endpin, leaning
// toward the player's left shoulder (viewer-right) so the scroll sits by the ear.
// Local coords: body centre at the origin, neck along −y. String 0 is the C string,
// which (seen from the audience) is on the viewer-right.

const VC = {
  nut: -84,
  bridge: 22,
  fbEnd: 10,
  /** String x at local y (strings fan out from nut to bridge). */
  sx: (i: number, y: number) => {
    const t = (y - -84) / (22 - -84);
    return (3 - 2 * i) + ((4.5 - 3 * i) - (3 - 2 * i)) * t;
  },
};
const VC_TILT = 17;
const VC_ENDPIN: Pt = { x: 110, y: 251 };
const VC_BOW = 100;

function vcPlace(f: Frame): Mat {
  const sway = Math.sin(f.t * 1.1) * (f.s.active.length ? 1.1 : 0.35);
  const th = VC_TILT + sway;
  const r = (th * Math.PI) / 180;
  // pivot on the endpin so swaying never lifts it off the floor
  const cx = VC_ENDPIN.x + 60 * Math.sin(r);
  const cy = VC_ENDPIN.y - 60 * Math.cos(r);
  return chain(tr(cx, cy), rot(th));
}

/** Map up to two simultaneous pitches onto adjacent strings. */
function vcStops(pitches: number[]): { string: number; semis: number }[] {
  if (!pitches.length) return [];
  const ps = [...pitches].sort((a, b) => a - b).slice(-2);
  const hi = stringFor(ps[ps.length - 1], OPEN.cello);
  if (ps.length === 1) return [hi];
  let lo = stringFor(ps[0], OPEN.cello);
  if (lo.string >= hi.string) {
    if (hi.string > 0) lo = { string: hi.string - 1, semis: Math.max(0, ps[0] - OPEN.cello[hi.string - 1]) };
    else return [hi];
  }
  return [lo, hi];
}

export const cello: Rig = {
  follow: "world",
  seated: true,
  render(c) {
    const s = hash(c.animal + "vc");
    const stoolInk = "#5b3a20";
    const stoolWood = "#b77b45";
    const fb = (y0: number, y1: number) => {
      const a = VC.sx(3, y0) - 1.6;
      const b = VC.sx(0, y0) + 1.6;
      const cc = VC.sx(3, y1) - 2.2;
      const d = VC.sx(0, y1) + 2.2;
      return `M${a.toFixed(1)} ${y0} L${b.toFixed(1)} ${y0} L${d.toFixed(1)} ${y1} L${cc.toFixed(1)} ${y1} Z`;
    };
    return {
      back: (
        <g>
          {/* little stool behind the player */}
          <L d="M88 230 L80 252 M152 230 L160 252 M120 232 L120 252 M84 244 H156" ink={stoolInk} seed={s + 20} w={3} />
          <S d={ellipsePath(120, 228, 42, 8)} ink={stoolInk} base={mix(stoolWood, "#fff", 0.2)} hatch={stoolWood} seed={s + 21} gap={3} />
        </g>
      ),
      front: (
        <g ref={c.bag.r("inst")}>
          <path d="M0 46 L0 60" stroke="#6d6a75" strokeWidth={2.4} strokeLinecap="round" />
          <S
            d="M0 -46 C-14 -46 -25 -40 -25 -27 C-25 -16 -17 -14 -17 -4 C-17 6 -31 8 -31 24 C-31 40 -16 46 0 46 C16 46 31 40 31 24 C31 8 17 6 17 -4 C17 -14 25 -16 25 -27 C25 -40 14 -46 0 -46 Z"
            ink={WOOD_INK}
            base={mix(WOOD, "#fff", 0.18)}
            hatch={WOOD_HATCH}
            seed={s}
            gap={3}
          />
          {/* purfling + f-holes */}
          <L d="M-9 -2 q-3 6 0 11 q3 5 0 11 M9 -2 q3 6 0 11 q-3 5 0 11" ink={WOOD_INK} seed={s + 1} w={1.3} />
          <path d="M-10.5 -3 h3 M-10.5 20 h3 M7.5 -3 h3 M7.5 20 h3" stroke={WOOD_INK} strokeWidth={1.2} />
          {/* neck + fingerboard + tailpiece */}
          <path d="M-3.6 -46 L-3 -86 L3 -86 L3.6 -46 Z" fill={mix(WOOD, "#000", 0.25)} />
          <path d={fb(VC.nut, VC.fbEnd)} fill={BOARD} />
          <path d="M-4.5 30 L4.5 30 L3.2 42 L-3.2 42 Z" fill={BOARD} />
          <path d="M-9 22 H9" stroke="#f1d9a8" strokeWidth={2.2} strokeLinecap="round" />
          <path d="M-8 24 v-3 M8 24 v-3" stroke={WOOD_INK} strokeWidth={1} />
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              ref={c.bag.r("str" + i)}
              d={`M${VC.sx(i, VC.nut).toFixed(2)} ${VC.nut} L${VC.sx(i, VC.bridge).toFixed(2)} ${VC.bridge} L${(VC.sx(i, VC.bridge) * 0.6).toFixed(2)} 31`}
              stroke={STRING}
              strokeWidth={i === 0 ? 1.1 : 0.85 - i * 0.05}
              fill="none"
            />
          ))}
          {/* pegbox + scroll */}
          <S d="M-3.5 -86 L-4 -100 L4 -100 L3.5 -86 Z" ink={WOOD_INK} base={WOOD} seed={s + 2} w={1.1} />
          <path d="M-5 -90 h-3 M-5 -95 h-3 M5 -91 h3 M5 -96 h3" stroke={WOOD_INK} strokeWidth={2} strokeLinecap="round" />
          <S d={ellipsePath(0, -105, 5.4, 5.6)} ink={WOOD_INK} base={WOOD} seed={s + 3} w={1.3} />
          <path d="M0 -105 m-2 0 a2 2 0 1 1 2 2" stroke={WOOD_INK} strokeWidth={1} fill="none" />
        </g>
      ),
      held: bowParts(c),
    };
  },
  update(c, f) {
    const m = c.mem;
    const local = vcPlace(f);
    c.bag.tf("inst", attr(local));
    const W = chain(f.M, local);
    const s = f.s;

    // What's sounding: the newest onset group (double-stops share an onset).
    const newestAge = s.active.length ? Math.min(...s.active.map((a) => a.age)) : Infinity;
    const group = s.active.filter((a) => a.age - newestAge < 0.03);
    // or, just before it, the next one (a whole double-stop, both strings)
    const soon = (s.upcoming ?? (s.nextPitch !== null ? [{ pitch: s.nextPitch, inSec: s.nextOnsetIn, vel: 0.7 }] : [])).filter((u) => u.inSec < 0.12);
    const upcoming = soon.filter((u) => u.inSec - soon[0].inSec < 0.03).map((u) => u.pitch);
    const pitches = group.length ? group.map((a) => a.pitch) : upcoming;
    const stops = vcStops(pitches);
    if (stops.length) {
      m.s0 = stops[0].string;
      m.m0 = stops[0].semis;
      m.s1 = stops[stops.length - 1].string;
      m.m1 = stops[stops.length - 1].semis;
      m.dbl = stops.length > 1 ? 1 : 0;
    }
    const strMid = ((m.s0 ?? 1) + (m.s1 ?? 1)) / 2;
    m.strS = (m.strS ?? strMid) + (strMid - (m.strS ?? strMid)) * approach(f.dt, 0.05);
    const semisMid = ((m.m0 ?? 3) + (m.m1 ?? 3)) / 2;
    m.semisS = (m.semisS ?? semisMid) + (semisMid - (m.semisS ?? semisMid)) * approach(f.dt, 0.035);

    // Pizz or arco? Follow the newest note (or the most recent onset).
    const lastArt = group[0]?.art ?? s.recent[0]?.art;
    const pizzNow = lastArt === "pizz" && (group.length > 0 || (s.recent[0]?.age ?? Infinity) < 1.5);
    m.pz = (m.pz ?? 0) + ((pizzNow ? 1 : 0) - (m.pz ?? 0)) * approach(f.dt, pizzNow ? 0.06 : 0.18);
    const pz = m.pz;

    // ── arco bow: alternate direction per onset, travel ∝ duration, louder → nearer the bridge
    if (m.dir === undefined) {
      m.dir = 1;
      m.b0 = 0.3;
      m.bs = 0.3;
      m.travel = 0.4;
      m.pluckT = -Infinity;
    }
    newOnsets(c, f, (o) => {
      if (o.art === "pizz") {
        m.pluckT = f.t - o.age;
        return;
      }
      const sounding = longestOf(s.active.filter((a) => Math.abs(a.age - o.age) < 0.03));
      const dur = sounding ? sounding.durSec : 0.4;
      m.b0 = m.bs;
      [m.dir, m.travel] = nextStroke(m.bs, -m.dir, clamp(0.12 + dur * 0.3, 0.12, 0.85));
      m.loud = o.vel;
    });
    const held = longestOf(group);
    const arcoNote = held && held.art !== "pizz" ? held : null;
    if (arcoNote) m.bs = clamp(m.b0 + m.dir * m.travel * Math.min(1, arcoNote.progress * 1.05), 0.04, 0.96);
    const toBridge = clamp(((m.loud ?? 0.6) - 0.5) * 2, 0, 1);
    const cy = 12 + toBridge * 6;
    const cx = VC.sx(0, cy) + (VC.sx(3, cy) - VC.sx(0, cy)) * (m.strS / 3);
    const C = ap(W, cx, cy);
    const strings = ap(W, 0, -1);
    const o0 = ap(W, 0, 0);
    const along = norm(strings.x - o0.x, strings.y - o0.y);
    // bow runs perpendicular to the strings, tilting with the string being played
    const u = rotV({ x: -along.y, y: along.x }, (m.strS - 1.5) * 6);
    const quiet = !group.length && s.nextOnsetIn > 0.5;
    m.lift = (m.lift ?? 0) + ((quiet ? 1 : 0) - (m.lift ?? 0)) * approach(f.dt, 0.12);
    const perp = { x: u.y, y: -u.x };
    const arcoFrog = {
      x: C.x - u.x * m.bs * VC_BOW + perp.x * m.lift * 8,
      y: C.y - u.y * m.bs * VC_BOW + perp.y * m.lift * 8,
    };

    // ── pizz: the bowing hand plucks near the end of the fingerboard, bow tucked in the palm
    const str = Math.round(m.s1 ?? 1);
    const pAge = f.t - (m.pluckT ?? -Infinity);
    const pull = pAge < 0.1 ? Math.sin((pAge / 0.1) * (Math.PI / 2)) : Math.exp(-(pAge - 0.1) / 0.12);
    const ready = s.nextOnsetIn < 0.15 ? 1 - s.nextOnsetIn / 0.15 : 0;
    const flick = Math.max(0, pull * (1 - ready)) * 9;
    const py = VC.fbEnd - 8;
    const pluck = ap(W, VC.sx(str, py) - 3 + flick, py + flick * 0.25);

    const hand = { x: arcoFrog.x + (pluck.x - arcoFrog.x) * pz, y: arcoFrog.y + (pluck.y - arcoFrog.y) * pz };
    // the bow: on the string (arco) or held in the palm pointing down-left (pizz)
    const parkDir = { x: -0.86, y: 0.5 };
    const dirX = u.x + (parkDir.x - u.x) * pz;
    const dirY = u.y + (parkDir.y - u.y) * pz;
    const dn = norm(dirX, dirY);
    const frog = { x: hand.x - dn.x * 4 * pz, y: hand.y - dn.y * 4 * pz };
    const tip = { x: frog.x + dn.x * VC_BOW, y: frog.y + dn.y * VC_BOW };
    const bp = { x: dn.y, y: -dn.x };
    c.bag.set("hair", "x1", frog.x);
    c.bag.set("hair", "y1", frog.y);
    c.bag.set("hair", "x2", tip.x);
    c.bag.set("hair", "y2", tip.y);
    c.bag.set("stick", "x1", frog.x + bp.x * 3);
    c.bag.set("stick", "y1", frog.y + bp.y * 3);
    c.bag.set("stick", "x2", tip.x + bp.x * 2);
    c.bag.set("stick", "y2", tip.y + bp.y * 2);
    c.bag.set("frog", "cx", frog.x + bp.x * 2);
    c.bag.set("frog", "cy", frog.y + bp.y * 2);
    f.arms.L = { hand, bend: 18, pawRot: 10 + pz * 50 };

    // ── left hand on the neck: follows the stopped note(s), spans a double-stop
    const stopY = VC.nut + (VC.bridge - VC.nut) * stopFrac(m.semisS);
    const sx = VC.sx(0, stopY) + (VC.sx(3, stopY) - VC.sx(0, stopY)) * (m.strS / 3);
    const lh = ap(W, sx + 7, stopY);
    const vib = arcoNote && arcoNote.durSec > 0.5 && arcoNote.progress > 0.2 ? Math.sin(f.t * 34) * 1.2 : 0;
    m.dblS = (m.dblS ?? 0) + ((m.dbl ?? 0) - (m.dblS ?? 0)) * approach(f.dt, 0.06);
    f.arms.R = { hand: { x: lh.x + vib, y: lh.y }, bend: -16, pawRot: -30, spread: 1 + m.dblS * 0.35 };

    // ── strings: bowed strings shimmer, plucked strings ring and decay
    const ring = pAge < 1.4 ? hit(pAge, 0.35) : 0;
    for (let i = 0; i < 4; i++) {
      const playing = group.length > 0 && (i === Math.round(m.s0 ?? -1) || i === Math.round(m.s1 ?? -1));
      const bowed = playing && !!arcoNote;
      const plucked = (i === Math.round(m.s0 ?? -1) || i === Math.round(m.s1 ?? -1)) && ring > 0.03;
      const amp = bowed ? 0.55 : plucked ? ring * 1.4 : 0;
      c.bag.tf("str" + i, amp ? `translate(${(Math.sin(f.t * 91 + i * 1.7) * amp).toFixed(2)} 0)` : "");
      c.bag.op("str" + i, playing || plucked ? 1 : 0.8);
    }
    f.look.bliss = !!arcoNote && arcoNote.durSec > 0.9 && arcoNote.progress > 0.2;
    f.look.lean = (m.bs - 0.5) * -3 * (1 - pz) + pz * hit(pAge, 0.2) * 1.5;
  },
};

// ─── Upright bass (pizzicato) ────────────────────────────────────────────────
//
// A double bass is taller than these animals: endpin on the floor, scroll above
// head height, standing just in front of the player's left side (viewer-right).
// Local coords: body centre at the origin, neck along −y; string 0 = E (viewer-right).

const CB = {
  nut: -110,
  bridge: 30,
  fbEnd: 18,
  sx: (i: number, y: number) => {
    const t = (y - -110) / (30 - -110);
    return (3.3 - 2.2 * i) + ((5.6 - 3.7 * i) - (3.3 - 2.2 * i)) * t;
  },
};
const CB_TILT = 5;
const CB_ENDPIN: Pt = { x: 150, y: 251 };

const CB_SCALE = 1.12;

function cbPlace(f: Frame): Mat {
  const th = CB_TILT + Math.sin(f.t * 1.2) * 0.6;
  const r = (th * Math.PI) / 180;
  const e = 72 * CB_SCALE;
  return chain(tr(CB_ENDPIN.x + e * Math.sin(r), CB_ENDPIN.y - e * Math.cos(r)), rot(th), scl(CB_SCALE));
}

export const bass: Rig = {
  follow: "world",
  render(c) {
    const s = hash(c.animal + "cb");
    const fb = `M${(CB.sx(3, CB.nut) - 1.8).toFixed(1)} ${CB.nut} L${(CB.sx(0, CB.nut) + 1.8).toFixed(1)} ${CB.nut} L${(CB.sx(0, CB.fbEnd) + 2.4).toFixed(1)} ${CB.fbEnd} L${(CB.sx(3, CB.fbEnd) - 2.4).toFixed(1)} ${CB.fbEnd} Z`;
    return {
      front: (
        <g ref={c.bag.r("inst")}>
          <path d="M0 60 L0 72" stroke="#6d6a75" strokeWidth={2.8} strokeLinecap="round" />
          <S
            d="M0 -60 C-10 -60 -15 -56 -19 -48 C-25 -38 -28 -26 -24 -16 C-21 -8 -21 0 -24 6 C-40 14 -43 40 -37 50 C-31 60 -15 62 0 62 C15 62 31 60 37 50 C43 40 40 14 24 6 C21 0 21 -8 24 -16 C28 -26 25 -38 19 -48 C15 -56 10 -60 0 -60 Z"
            ink={WOOD_INK}
            base={mix("#9a5424", "#fff", 0.2)}
            hatch="#c27a3d"
            seed={s}
            gap={3.2}
          />
          <L d="M-12 2 q-4 8 0 15 q4 8 0 15 M12 2 q4 8 0 15 q-4 8 0 15" ink={WOOD_INK} seed={s + 1} w={1.4} />
          <path d="M-13.5 1 h3 M-13.5 32 h3 M10.5 1 h3 M10.5 32 h3" stroke={WOOD_INK} strokeWidth={1.3} />
          <path d="M-4.2 -60 L-3.4 -112 L3.4 -112 L4.2 -60 Z" fill={mix("#9a5424", "#000", 0.25)} />
          <path d={fb} fill={BOARD} />
          <path d="M-5.5 38 L5.5 38 L4 54 L-4 54 Z" fill={BOARD} />
          <path d="M-11 30 H11" stroke="#f1d9a8" strokeWidth={2.6} strokeLinecap="round" />
          <path d="M-10 32 v-4 M10 32 v-4" stroke={WOOD_INK} strokeWidth={1.1} />
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              ref={c.bag.r("str" + i)}
              d={`M${CB.sx(i, CB.nut).toFixed(2)} ${CB.nut} L${CB.sx(i, CB.bridge).toFixed(2)} ${CB.bridge} L${(CB.sx(i, CB.bridge) * 0.6).toFixed(2)} 40`}
              stroke={STRING}
              strokeWidth={1.25 - i * 0.12}
              fill="none"
            />
          ))}
          <S d="M-4 -112 L-4.5 -128 L4.5 -128 L4 -112 Z" ink={WOOD_INK} base="#9a5424" seed={s + 2} w={1.1} />
          <path d="M-5.5 -116 h-4 M-5.5 -123 h-4 M5.5 -117 h4 M5.5 -124 h4" stroke="#c9c5d6" strokeWidth={2.2} strokeLinecap="round" />
          <S d={ellipsePath(0, -134, 6, 6.2)} ink={WOOD_INK} base="#9a5424" seed={s + 3} w={1.3} />
          <path d="M0 -134 m-2.4 0 a2.4 2.4 0 1 1 2.4 2.4" stroke={WOOD_INK} strokeWidth={1.1} fill="none" />
        </g>
      ),
    };
  },
  update(c, f) {
    const m = c.mem;
    const local = cbPlace(f);
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
    m.strS = (m.strS ?? str) + (str - (m.strS ?? str)) * approach(f.dt, 0.05);
    m.semisS = (m.semisS ?? 3) + ((m.semis ?? 3) - (m.semisS ?? 3)) * approach(f.dt, 0.03);
    const last = f.s.recent[0];
    const age = last ? last.age : Infinity;
    // Pluck: finger rests on the string, pulls through on the onset, then drifts back.
    const pull = age < 0.12 ? Math.sin((age / 0.12) * (Math.PI / 2)) : Math.exp(-(age - 0.12) / 0.12);
    const ready = f.s.nextOnsetIn < 0.15 ? 1 - f.s.nextOnsetIn / 0.15 : 0;
    const flick = Math.max(0, pull * (1 - ready)) * 12;
    const py = CB.fbEnd - 10;
    const pluckLocal = { x: CB.sx(m.strS, py) - 4 + flick, y: py + flick * 0.3 };
    f.arms.L = { hand: ap(W, pluckLocal.x, pluckLocal.y), bend: 14, pawRot: 60 };
    // a shift up or down the neck travels at a hand's speed, however far it goes
    const wantY = CB.nut + (CB.bridge - CB.nut) * stopFrac(m.semisS);
    m.stopY = slewTo(m.stopY ?? wantY, wantY, f.dt, 0.02, 900);
    const stopY = m.stopY;
    f.arms.R = { hand: ap(W, CB.sx(m.strS, stopY) + 8, stopY), bend: -30, pawRot: -40 };
    for (let i = 0; i < 4; i++) {
      const ring = age < 1.2 && i === str ? hit(age, 0.35) : 0;
      c.bag.tf("str" + i, ring > 0.02 ? `translate(${(Math.sin(f.t * 70) * ring * 1.6).toFixed(2)} 0)` : "");
    }
    f.look.lean = -1.5 + hit(age, 0.2) * 1.2;
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
          m.sFrom = m.hyLast ?? -12 * m.sdir;
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
    // Strums cross the strings over the sound hole and follow through a little; between
    // strums the hand drifts back to hover just past the strings, not parked at the body's edge.
    let hy: number;
    let hx = 0;
    if (sAge <= pAge) {
      const k = clamp(sAge / 0.085, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      const settle = clamp((sAge - 0.12) / 0.3, 0, 1);
      const reach = 12 - 6 * settle * settle * (3 - 2 * settle);
      const from = m.sFrom ?? -12 * m.sdir;
      hy = from + (m.sdir * reach - from) * e;
    } else {
      const flick = hit(pAge, 0.06);
      hy = GTR_Y(m.pStr) + 2 + flick * 4;
      hx = -4 + flick * 3;
    }
    m.hyLast = hy;
    f.arms.L = { hand: ap(W, hx, hy), bend: 16, pawRot: 40 };
    for (let i = 0; i < 6; i++) {
      const ring = f.s.active.length && Math.min(sAge, pAge) < 1.5 ? hit(Math.min(sAge, pAge), 0.3) : 0;
      c.bag.tf("str" + i, ring > 0.03 ? `translate(0 ${(Math.sin(f.t * 90 + i) * ring * 0.6).toFixed(2)})` : "");
    }
    f.look.lean = -2 + Math.sin(f.t * 1.3) * (f.s.active.length ? 1.5 : 0.5);
    f.look.bliss = f.s.featured && f.s.active.some((a) => a.durSec > 0.8);
  },
};
