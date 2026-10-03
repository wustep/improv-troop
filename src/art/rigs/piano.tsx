import { L, S, ellipsePath, hash, mix, rectPath } from "../sketch";
import { approach, clamp } from "../affine";
import { isBlack, keyUnits } from "../fingering";
import { type Rig, type RigCtx, type Frame, hit } from "./types";

// Keyboard spans C2 (36) … C7 (96).
const LO = 36;
const HI = 96;
const X0 = 22;
const X1 = 218;
const KEY_TOP = 172;
const KEY_BOT = 189;
const WHITE_COUNT = keyUnits(HI) - keyUnits(LO) + 1;
const KW = (X1 - X0) / WHITE_COUNT;

export function keyX(p: number): number {
  const q = clamp(p, LO - 6, HI + 6);
  return X0 + (keyUnits(q) - keyUnits(LO) + 0.5) * KW;
}

const POOL = 10;
const SPLIT = 60;

export const piano: Rig = {
  follow: "world",
  seated: true,
  render(c: RigCtx) {
    const wood = "#7f97c4";
    const woodHatch = "#5a77b0";
    const woodInk = "#2a3f66";
    const seps: string[] = [];
    const blacks: string[] = [];
    for (let p = LO; p <= HI; p++) {
      const x = keyX(p);
      if (isBlack(p)) blacks.push(rectPath(x - KW * 0.32, KEY_TOP, KW * 0.64, 10));
      else if (p > LO) seps.push(`M${(x - KW / 2).toFixed(1)} ${KEY_TOP} V${KEY_BOT}`);
    }
    const s = hash(c.animal + "piano");
    return {
      front: (
        <g>
          {/* case */}
          <S d={rectPath(14, 186, 212, 58, 6)} ink={woodInk} base={mix(wood, "#f6f0e1", 0.35)} hatch={woodHatch} seed={s} gap={4} />
          <S d={rectPath(10, 166, 220, 24, 4)} ink={woodInk} base={mix(wood, "#f6f0e1", 0.2)} hatch={woodHatch} seed={s + 1} gap={3.5} />
          <L d="M26 244 v6 M214 244 v6" ink={woodInk} seed={s + 2} w={3} />
          {/* keybed */}
          <path d={rectPath(X0, KEY_TOP, X1 - X0, KEY_BOT - KEY_TOP)} fill="#fffdf4" stroke="#2c2a35" strokeWidth={1.4} />
          {/* pressed-key highlights live under the key lines */}
          {Array.from({ length: POOL }, (_, i) => (
            <rect key={i} ref={c.bag.r("kh" + i)} y={KEY_TOP} width={KW} height={KEY_BOT - KEY_TOP} fill={c.fill} style={{ opacity: 0 }} />
          ))}
          <path d={seps.join(" ")} stroke="#2c2a35" strokeWidth={0.8} strokeOpacity={0.75} />
          <path d={blacks.join(" ")} fill="#2c2a35" />
          {Array.from({ length: POOL }, (_, i) => (
            <rect key={i} ref={c.bag.r("kb" + i)} y={KEY_TOP} width={KW * 0.64} height={10} fill={mix(c.fill, "#000000", 0.2)} style={{ opacity: 0 }} />
          ))}
          <S d={rectPath(X0 - 1, KEY_TOP - 1, X1 - X0 + 2, KEY_BOT - KEY_TOP + 2)} ink="#2c2a35" seed={s + 3} w={1.6} />
          {/* little doodled music stand notes on the case */}
          <L d="M150 212 q6 -10 12 0 M180 224 q4 -6 8 0" ink="#fffdf4" seed={s + 4} w={1.4} op={0.8} />
          <S d={ellipsePath(40, 216, 4, 3.2)} ink="#fffdf4" base="#fffdf4" seed={s + 5} w={1} />
          <L d="M37 216 v-12 q4 2 6 6" ink="#fffdf4" seed={s + 6} w={1.3} op={0.9} />
        </g>
      ),
    };
  },
  update(c: RigCtx, f: Frame) {
    const { s } = f;
    const m = c.mem;
    // Highlight sounding keys (they stay down while the note sounds).
    let wi = 0;
    let bi = 0;
    for (const n of s.active) {
      const x = keyX(n.pitch);
      const a = 0.35 + 0.5 * (1 - n.progress * 0.6);
      if (isBlack(n.pitch)) {
        if (bi < POOL) {
          c.bag.set("kb" + bi, "x", x - KW * 0.32);
          c.bag.op("kb" + bi, a);
          bi++;
        }
      } else if (wi < POOL) {
        c.bag.set("kh" + wi, "x", x - KW / 2);
        c.bag.op("kh" + wi, a);
        wi++;
      }
    }
    for (; wi < POOL; wi++) c.bag.op("kh" + wi, 0);
    for (; bi < POOL; bi++) c.bag.op("kb" + bi, 0);

    // Hands: split at middle C. Each hand goes to the centre of its sounding notes,
    // or to its next note just before it arrives.
    const hands = [
      { key: "L", lo: -Infinity, hi: SPLIT - 1, home: keyX(48) },
      { key: "R", lo: SPLIT, hi: Infinity, home: keyX(72) },
    ] as const;
    let leanSum = 0;
    let leanW = 0;
    for (const h of hands) {
      const inHand = (p: number) => p >= h.lo && p <= h.hi;
      const act = s.active.filter((n) => inHand(n.pitch));
      const last = s.recent.find((o) => inHand(o.pitch));
      const nextHere = s.nextPitch !== null && inHand(s.nextPitch);
      let target: number | null = null;
      let spread = 1;
      if (nextHere && s.nextOnsetIn < 0.22 && (act.length === 0 || s.nextOnsetIn < 0.08)) {
        target = keyX(s.nextPitch!);
      } else if (act.length) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const n of act) {
          const x = keyX(n.pitch);
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
        target = (lo + hi) / 2;
        spread = clamp((hi - lo) / 16, 1, 2.4);
      }
      const kx = "hx" + h.key;
      const ks = "hs" + h.key;
      if (m[kx] === undefined) m[kx] = h.home;
      if (m[ks] === undefined) m[ks] = 1;
      const tau = target === null ? 0.9 : 0.035;
      m[kx] += ((target ?? (m[kx] * 0.85 + h.home * 0.15)) - m[kx]) * approach(f.dt, tau);
      m[ks] += (spread - m[ks]) * approach(f.dt, 0.05);
      const lastAge = last ? last.age : Infinity;
      const press = hit(lastAge, 0.06) * (3 + 4 * (last?.vel ?? 0.5));
      const nextIn = nextHere ? s.nextOnsetIn : Infinity;
      const prep = nextIn < 0.16 ? Math.sin(Math.PI * (1 - nextIn / 0.16)) * 6 : 0;
      const resting = act.length === 0 && lastAge > 0.6 && nextIn > 0.6;
      const y = KEY_TOP + 6 + press - prep - (resting ? 2 : 0);
      f.arms[h.key] = { hand: { x: m[kx], y }, spread: m[ks], bend: 10, pawRot: h.key === "L" ? 12 : -12 };
      const w = act.length + hit(lastAge, 0.2);
      leanSum += (m[kx] - 120) * w;
      leanW += w;
    }
    f.look.lean = leanW > 0 ? clamp((leanSum / leanW) * 0.06, -6, 6) : 0;
    const big = s.recent.length ? hit(s.recent[0].age, 0.12) * s.recent.filter((o) => o.age < 0.03).length : 0;
    f.look.dip = clamp(big * 1.2, 0, 4);
    f.look.bliss = s.active.some((n) => n.durSec > 1.2 && n.progress > 0.15);
  },
};
