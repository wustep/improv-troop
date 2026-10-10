import { L, S, ellipsePath, hash, mix, rectPath } from "../sketch";
import { clamp } from "../affine";
import { isBlack, keyUnits } from "../fingering";
import { type Frame, type Rig, type RigCtx, damp, glide, slewTo, hit, strokeLift } from "./types";

// Bars F3 (53) … F6 (89).
const LO = 53;
const HI = 89;
const X0 = 20;
const X1 = 220;
const NAT_Y = 190;
const ACC_Y = 175;
const COUNT = keyUnits(HI) - keyUnits(LO) + 1;
const BW = (X1 - X0) / COUNT;
const MALLET = 34;
const POOL = 6;

export function barX(p: number) {
  const q = clamp(p, LO - 5, HI + 5);
  return X0 + (keyUnits(q) - keyUnits(LO) + 0.5) * BW;
}
const barY = (p: number) => (isBlack(p) ? ACC_Y + 5 : NAT_Y + 6);
function barLen(p: number, black: boolean) {
  const t = (clamp(p, LO, HI) - LO) / (HI - LO);
  return (black ? 14 : 22) - t * 7;
}

// Four-mallet grip, like a jazz vibraphonist: per paw an outer mallet (0) and an inner one (1).
type Mallet = "L0" | "L1" | "R1" | "R0";
const MALLETS: Mallet[] = ["L0", "L1", "R1", "R0"];

/**
 * Which mallet takes which note. Chords spread across the mallets low → high (two notes:
 * the inner pair; three: both left + right inner; four: all of them). A single note goes to
 * the inner mallet of the nearer paw, and that paw's outer mallet stays a few steps outside.
 */
function grip(chord: number[], m: Record<string, number>): Partial<Record<Mallet, number>> {
  const ps = [...new Set(chord)].sort((a, b) => a - b);
  if (ps.length >= 4) return { L0: ps[0], L1: ps[1], R1: ps[ps.length - 2], R0: ps[ps.length - 1] };
  if (ps.length === 3) return { L0: ps[0], L1: ps[1], R1: ps[2], R0: Math.max(m.pR0, ps[2] + 3) };
  if (ps.length === 2) {
    // a close pair at either end of the bars is one paw's two mallets: both paws down there
    // laid the far arm across the body
    if (ps[1] - ps[0] <= 9 && barX(ps[1]) < 76) return { L0: ps[0], L1: ps[1], R1: Math.max(m.pR1, ps[1] + 3), R0: Math.max(m.pR0, ps[1] + 7) };
    if (ps[1] - ps[0] <= 9 && barX(ps[0]) > 164) return { R1: ps[0], R0: ps[1], L1: Math.min(m.pL1, ps[0] - 3), L0: Math.min(m.pL0, ps[0] - 7) };
    return { L1: ps[0], R1: ps[1], L0: Math.min(m.pL0, ps[0] - 3), R0: Math.max(m.pR0, ps[1] + 3) };
  }
  const p = ps[0];
  let arm: "L" | "R" = Math.abs(p - m.pL1) <= Math.abs(p - m.pR1) ? "L" : "R";
  // don't cross the other paw
  if (arm === "L" && p > m.pR1 + 2) arm = "R";
  if (arm === "R" && p < m.pL1 - 2) arm = "L";
  return arm === "L" ? { L1: p, L0: p - 4, R1: Math.max(m.pR1, p + 3), R0: Math.max(m.pR0, p + 7) } : { R1: p, R0: p + 4, L1: Math.min(m.pL1, p - 3), L0: Math.min(m.pL0, p - 7) };
}

export const vibes: Rig = {
  follow: "world",
  seated: true,
  render(c: RigCtx) {
    const s = hash(c.animal + "vibes");
    const nat: string[] = [];
    const acc: string[] = [];
    for (let p = LO; p <= HI; p++) {
      const x = barX(p);
      const b = isBlack(p);
      const len = barLen(p, b);
      (b ? acc : nat).push(rectPath(x - BW * (b ? 0.36 : 0.42), b ? ACC_Y : NAT_Y, BW * (b ? 0.72 : 0.84), len, 1.5));
    }
    const metal = "#d9d6e2";
    const metalInk = "#5d5870";
    const gold = "#e8c46a";
    const goldInk = "#9a7424";
    // one resonator tube under every natural bar, longest in the bass
    const tubes: string[] = [];
    for (let p = LO; p <= HI; p++) {
      if (isBlack(p)) continue;
      const x = barX(p);
      const len = 30 - ((p - LO) / (HI - LO)) * 18;
      tubes.push(`M${x.toFixed(1)} ${NAT_Y + 24} v${len.toFixed(1)}`);
    }
    const cordN: string[] = [];
    const cordA: string[] = [];
    for (let p = LO; p <= HI; p++) {
      const x = barX(p);
      (isBlack(p) ? cordA : cordN).push(`M${(x - 1).toFixed(1)} ${isBlack(p) ? ACC_Y + 3 : NAT_Y + 4} h2`);
    }
    return {
      // the damper pedal: a long bar near the floor, so the foot finds it wherever the player stands
      back: (
        <g ref={c.bag.r("pedal")}>
          <L d="M30 236 L40 245 M210 236 L200 245" ink="#3b3446" seed={s + 9} w={1.6} />
          <S d={rectPath(38, 243, 164, 3.4, 1.5)} ink="#3b3446" base="#8f8b99" seed={s + 10} w={1.2} />
        </g>
      ),
      front: (
        <g>
          {/* legs on little wheels */}
          <L d="M26 214 L22 250 M214 214 L218 250 M26 236 H214" ink="#3b3446" seed={s} w={3} />
          <S d={ellipsePath(22, 251, 4, 3)} ink="#3b3446" base="#6d6a75" seed={s + 7} w={1.2} />
          <S d={ellipsePath(218, 251, 4, 3)} ink="#3b3446" base="#6d6a75" seed={s + 8} w={1.2} />
          {/* gold resonators hanging under the bars */}
          <path d={tubes.join(" ")} stroke={goldInk} strokeWidth={BW * 0.62} strokeLinecap="round" />
          <path d={tubes.join(" ")} stroke={gold} strokeWidth={BW * 0.42} strokeLinecap="round" />
          {/* rails */}
          <S d={rectPath(14, ACC_Y + 2, 212, 5, 2)} ink="#3b3446" base="#5b5468" seed={s + 1} w={1.4} />
          <S d={rectPath(12, NAT_Y + 3, 216, 6, 2)} ink="#3b3446" base="#5b5468" seed={s + 2} w={1.4} />
          {/* bars: accidentals raised behind, naturals in front, each its own bar on the cord */}
          <path d={acc.join(" ")} fill={mix(metal, "#2c2a35", 0.18)} stroke={metalInk} strokeWidth={1.1} />
          <path d={nat.join(" ")} fill={metal} stroke={metalInk} strokeWidth={1.1} />
          <path d={[...cordN, ...cordA].join(" ")} stroke="#2c2a35" strokeWidth={1.6} strokeLinecap="round" />
          {Array.from({ length: POOL }, (_, i) => (
            <rect key={i} ref={c.bag.r("bf" + i)} width={BW * 0.84} height={20} rx={1.5} fill={c.fill} style={{ opacity: 0 }} />
          ))}
          <L d={`M${barX(LO) - 4} ${NAT_Y + 14} h3 M${barX(HI) + 1} ${NAT_Y + 9} h3`} ink={metalInk} seed={s + 3} w={1} op={0.5} />
        </g>
      ),
      held: (
        <g>
          {MALLETS.map((k) => (
            <g key={k}>
              <line ref={c.bag.r("m" + k)} stroke="#8a5a2b" strokeWidth={2} strokeLinecap="round" />
              <g ref={c.bag.r("mb" + k)}>
                <circle r={5.2} fill={k[0] === "L" ? "#c8463c" : "#3b5bab"} stroke="#2c2a35" strokeWidth={1.2} />
                <path d="M-3 -1.8 q3 -2.2 6 0 M-3.5 1.3 q3.5 -2.2 7 0" stroke="#fffdf4" strokeOpacity={0.55} strokeWidth={1} fill="none" />
              </g>
            </g>
          ))}
        </g>
      ),
    };
  },
  update(c: RigCtx, f: Frame) {
    const { s } = f;
    const m = c.mem;
    if (m.pL1 === undefined) {
      m.pL0 = 60;
      m.pL1 = 65;
      m.pR1 = 77;
      m.pR0 = 81;
      for (const k of MALLETS) m["t" + k] = -Infinity;
    }
    // New onsets, grouped into chords (everything struck within 20 ms), oldest first.
    if (m.seenBeat !== undefined && s.beat < m.seenBeat - 0.25) m.lastOnsetBeat = -Infinity;
    m.seenBeat = s.beat;
    const bps = (s.bpm || 120) / 60;
    const fresh = s.recent.filter((o) => o.age <= 0.5 && s.beat - o.age * bps > (m.lastOnsetBeat ?? -Infinity) + 0.01);
    for (const age of [...new Set(fresh.map((o) => Math.round(o.age * 50) / 50))].sort((a, b) => b - a)) {
      const chord = fresh.filter((o) => Math.abs(o.age - age) < 0.02).map((o) => o.pitch);
      const T = f.t - age;
      for (const [k, p] of Object.entries(grip(chord, m))) {
        m["p" + k] = p;
        if (chord.includes(p)) m["t" + k] = T;
      }
      m.lastOnsetBeat = Math.max(m.lastOnsetBeat ?? -Infinity, s.beat - age * bps);
    }
    // What's coming: the next chord (or note) gets the same grip, so the right mallets wind up.
    const next: Partial<Record<Mallet, { pitch: number; inSec: number; strike: boolean }>> = {};
    const up = (s.upcoming ?? (s.nextPitch !== null ? [{ pitch: s.nextPitch, inSec: s.nextOnsetIn, vel: 0.7 }] : [])).filter((u) => u.inSec < 0.25);
    if (up.length) {
      const first = up.filter((u) => u.inSec - up[0].inSec < 0.02);
      const chord = first.map((u) => u.pitch);
      for (const [k, p] of Object.entries(grip(chord, m))) next[k as Mallet] = { pitch: p, inSec: first[0].inSec, strike: chord.includes(p) };
    }

    const heads = {} as Record<Mallet, { x: number; y: number }>;
    for (const k of MALLETS) {
      const lastAge = f.t - m["t" + k];
      // a mallet rebounds off its bar before it travels to the next one
      const nx = next[k] && (lastAge > 0.07 || next[k]!.inSec < 0.1) ? next[k] : undefined;
      const pitch = nx ? nx.pitch : m["p" + k];
      let lift = strokeLift(lastAge, nx?.strike ? nx.inSec : Infinity, s.playing ? 0.6 : 0.3);
      // an outer mallet that isn't playing rides a little higher, out of the way (eased, or it pops up)
      const park = k.endsWith("0") && !nx?.strike && lastAge > 0.15 ? 0.75 : 0;
      m["park" + k] = slewTo(m["park" + k] ?? park, park, f.dt, 0.05, 4);
      lift = Math.max(lift, m["park" + k]);
      const kx = "x" + k;
      glide(m, kx, barX(pitch), f.dt, 26000, 1100);
      // the accidental row sits higher than the naturals: ease between them too
      glide(m, "y" + k, barY(pitch), f.dt, 20000, 600);
      heads[k] = { x: m[kx], y: m["y" + k] - lift * 22 };
      c.bag.tf("mb" + k, `translate(${heads[k].x.toFixed(1)} ${heads[k].y.toFixed(1)})`);
    }
    for (const arm of ["L", "R"] as const) {
      const a = heads[(arm + "0") as Mallet];
      const b = heads[(arm + "1") as Mallet];
      // the paw sits behind and above both heads; the shafts fan out from it
      const hand = { x: (a.x + b.x) / 2 + (arm === "L" ? -6 : 6), y: Math.min(a.y, b.y) - MALLET + 12 };
      for (const k of [arm + "0", arm + "1"]) {
        c.bag.set("m" + k, "x1", hand.x);
        c.bag.set("m" + k, "y1", hand.y);
        c.bag.set("m" + k, "x2", heads[k as Mallet].x);
        c.bag.set("m" + k, "y2", heads[k as Mallet].y);
      }
      m["x" + arm] = hand.x;
      f.arms[arm] = { hand, bend: 12, pawRot: arm === "L" ? 15 : -15, spread: clamp(Math.abs(a.x - b.x) / 14, 1, 1.6) };
    }
    // Bars ring while the note sounds (vibes sustain), flash on the strike.
    let i = 0;
    for (const n of s.active) {
      if (i >= POOL) break;
      const b = isBlack(n.pitch);
      c.bag.set("bf" + i, "x", barX(n.pitch) - BW * 0.42);
      c.bag.set("bf" + i, "y", b ? ACC_Y : NAT_Y);
      c.bag.set("bf" + i, "height", barLen(n.pitch, b));
      c.bag.op("bf" + i, 0.25 + 0.5 * hit(n.age, 0.12));
      i++;
    }
    for (; i < POOL; i++) c.bag.op("bf" + i, 0);
    // Damper pedal: down while notes ring on (held notes, chords), up to stop them, and lifted for
    // an instant as a new chord lands so the old one doesn't smear into it.
    const ringing = s.active.some((n) => n.durSec > 0.35) || s.active.length >= 2;
    const fresh2 = s.recent.filter((o) => o.age < 0.06).length >= 2;
    const want = s.playing && ringing && !fresh2 ? 1 : 0;
    const pedal = damp(m, "pedal", want, f.dt, want ? 0.04 : 0.03);
    c.bag.tf("pedal", `translate(0 ${(pedal * 1.6).toFixed(2)})`);
    f.look.pedal = pedal;
    // the player walks along the bars toward where the mallets are, and leans the rest of the way
    const mid = (m.xL + m.xR) / 2 - 120;
    f.look.shift = clamp(mid * 0.6, -26, 26);
    f.look.lean = clamp(mid * 0.05, -5, 5);
    f.look.bliss = s.active.some((n) => n.durSec > 1.2 && n.progress > 0.2);
  },
};
