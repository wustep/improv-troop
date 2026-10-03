import { L, S, ellipsePath, hash, mix, rectPath } from "../sketch";
import { approach, clamp } from "../affine";
import { isBlack, keyUnits } from "../fingering";
import { type Frame, type Rig, type RigCtx, hit, newOnsets, strokeLift } from "./types";

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
          {(["L", "R"] as const).map((k) => (
            <g key={k}>
              <line ref={c.bag.r("m" + k)} stroke="#8a5a2b" strokeWidth={2.2} strokeLinecap="round" />
              <g ref={c.bag.r("mb" + k)}>
                <circle r={6} fill={k === "L" ? "#c8463c" : "#3b5bab"} stroke="#2c2a35" strokeWidth={1.3} />
                <path d="M-3.5 -2 q3.5 -2.5 7 0 M-4 1.5 q4 -2.5 8 0" stroke="#fffdf4" strokeOpacity={0.55} strokeWidth={1} fill="none" />
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
    if (m.pL === undefined) {
      m.pL = 65;
      m.pR = 77;
      m.aL = Infinity;
      m.aR = Infinity;
      m.tL = -Infinity;
      m.tR = -Infinity;
    }
    // Assign each new onset to a mallet: chords spread low→L / high→R, single notes go to the nearest mallet.
    newOnsets(c, f, (o) => {
      const T = f.t - o.age;
      let arm: "L" | "R";
      if (o.chordSize >= 2) {
        const chord = s.recent.filter((q) => Math.abs(q.age - o.age) < 0.02).map((q) => q.pitch);
        arm = o.pitch <= Math.min(...chord) ? "L" : o.pitch >= Math.max(...chord) ? "R" : Math.abs(o.pitch - m.pL) < Math.abs(o.pitch - m.pR) ? "L" : "R";
      } else {
        const dl = Math.abs(o.pitch - m.pL);
        const dr = Math.abs(o.pitch - m.pR);
        arm = dl === dr ? (m.tL < m.tR ? "L" : "R") : dl < dr ? "L" : "R";
        // don't cross the other mallet
        if (arm === "L" && o.pitch > m.pR + 2) arm = "R";
        if (arm === "R" && o.pitch < m.pL - 2) arm = "L";
      }
      m["p" + arm] = o.pitch;
      m["t" + arm] = T;
    });
    // Anticipate the next note with whichever mallet is nearer.
    let nextArm: "L" | "R" | null = null;
    if (s.nextPitch !== null && s.nextOnsetIn < 0.25) {
      nextArm = Math.abs(s.nextPitch - m.pL) <= Math.abs(s.nextPitch - m.pR) ? "L" : "R";
    }
    for (const arm of ["L", "R"] as const) {
      const pitch = nextArm === arm ? s.nextPitch! : m["p" + arm];
      const lastAge = f.t - m["t" + arm];
      const lift = strokeLift(lastAge, nextArm === arm ? s.nextOnsetIn : Infinity, s.playing ? 0.6 : 0.3);
      const tx = barX(pitch);
      const ty = barY(pitch);
      const kx = "x" + arm;
      if (m[kx] === undefined) m[kx] = tx;
      m[kx] += (tx - m[kx]) * approach(f.dt, 0.03);
      const head = { x: m[kx], y: ty - lift * 22 };
      const hand = { x: m[kx] + (arm === "L" ? -8 : 8), y: ty - MALLET + 4 - lift * 10 };
      c.bag.set("m" + arm, "x1", hand.x);
      c.bag.set("m" + arm, "y1", hand.y);
      c.bag.set("m" + arm, "x2", head.x);
      c.bag.set("m" + arm, "y2", head.y);
      c.bag.tf("mb" + arm, `translate(${head.x.toFixed(1)} ${head.y.toFixed(1)})`);
      f.arms[arm] = { hand, bend: 12, pawRot: arm === "L" ? 15 : -15 };
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
    f.look.lean = clamp(((m.xL + m.xR) / 2 - 120) * 0.05, -5, 5);
    f.look.bliss = s.active.some((n) => n.durSec > 1.2 && n.progress > 0.2);
  },
};
