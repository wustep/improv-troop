import { L, S, ellipsePath, hash, mix, rectPath } from "../sketch";
import { approach, clamp } from "../affine";
import { isBlack, keyUnits } from "../fingering";
import { type Rig, type RigCtx, type Frame, hit, nextWhere } from "./types";

// A little black-lacquer upright, cartoon-style: the keyboard faces the audience so
// you can see which keys go down, and it sits low enough that the player's chest,
// shoulders and arms show above it. The player perches on a round stool behind.
//
// Keyboard spans C2 (36) … C7 (96).
const LO = 36;
const HI = 96;
const X0 = 24;
const X1 = 216;
const KEY_TOP = 197;
const KEY_BOT = 212;
const BLACK_H = 9;
const WHITE_COUNT = keyUnits(HI) - keyUnits(LO) + 1;
const KW = (X1 - X0) / WHITE_COUNT;

export function keyX(p: number): number {
  const q = clamp(p, LO - 6, HI + 6);
  return X0 + (keyUnits(q) - keyUnits(LO) + 0.5) * KW;
}

const POOL = 10;
const SPLIT = 60;

const LACQUER = "#3f3849";
const LACQUER_HATCH = "#6c6381";
const CASE_INK = "#221d2b";
const GOLD = "#d9a43a";
const GOLD_INK = "#8a6418";
const IVORY = "#fffbef";
const STOOL = "#b77b45";
const STOOL_INK = "#5b3a20";

export const piano: Rig = {
  follow: "world",
  seated: true,
  hideFeet: true,
  render(c: RigCtx) {
    const seps: string[] = [];
    const blacks: string[] = [];
    for (let p = LO; p <= HI; p++) {
      const x = keyX(p);
      if (isBlack(p)) blacks.push(rectPath(x - KW * 0.32, KEY_TOP, KW * 0.64, BLACK_H));
      else if (p > LO) seps.push(`M${(x - KW / 2).toFixed(1)} ${KEY_TOP} V${KEY_BOT}`);
    }
    const s = hash(c.animal + "piano");
    return {
      back: (
        <g>
          {/* the propped-open lid rising behind the player: the piano silhouette everyone knows */}
          <S
            d="M30 190 C34 168 60 146 104 126 C146 106 190 92 214 88 C226 86 230 98 226 112 L222 190 Z"
            ink={CASE_INK}
            base={mix(LACQUER, "#fff", 0.08)}
            hatch={LACQUER_HATCH}
            seed={s + 22}
            gap={3.4}
          />
          <L d="M36 186 C44 166 66 150 106 132 C146 114 186 100 212 96" ink={GOLD} seed={s + 23} w={1.3} op={0.7} />
          {/* prop stick */}
          <L d="M200 188 L214 100" ink={CASE_INK} seed={s + 24} w={2.6} />
          {/* round stool: legs peek out under the piano */}
          <L d="M100 228 L92 250 M140 228 L148 250 M120 230 L120 250 M96 242 H144" ink={STOOL_INK} seed={s + 20} w={3} />
          <S d={ellipsePath(120, 227, 30, 6)} ink={STOOL_INK} base={mix(STOOL, "#fff", 0.2)} hatch={STOOL} seed={s + 21} gap={3} />
        </g>
      ),
      front: (
        <g>
          {/* a sheet of music propped on the lid (behind the arms) */}
          <g transform="rotate(-8 50 176)">
            <S d={rectPath(30, 158, 40, 30, 1.5)} ink="#5b5666" base="#fffdf6" seed={s + 1} w={1.4} />
            <path d="M34 166 H66 M34 169 H66 M34 172 H66 M34 178 H66 M34 181 H66 M34 184 H66" stroke="#8d879a" strokeWidth={0.6} />
            <L d="M40 168 v-6 M47 171 v-7 M55 181 v-7 M61 179 v-6" ink="#2c2a35" seed={s + 2} w={0.9} />
            <path d="M39.2 168.3 a1.4 1.1 -20 1 0 0.1 0 Z M46.2 171.3 a1.4 1.1 -20 1 0 0.1 0 Z M54.2 181.3 a1.4 1.1 -20 1 0 0.1 0 Z M60.2 179.3 a1.4 1.1 -20 1 0 0.1 0 Z" fill="#2c2a35" stroke="#2c2a35" strokeWidth={1.4} />
          </g>
          {/* candle in a brass holder, flame flickers */}
          <S d={rectPath(196, 168, 7, 16, 1.5)} ink="#b9ab8c" base="#fbf3dc" seed={s + 3} w={1.1} />
          <S d="M190 186 Q199.5 180 209 186 Q199.5 191 190 186 Z" ink={GOLD_INK} base={GOLD} seed={s + 4} w={1.2} />
          <g ref={c.bag.r("flame")} transform="translate(199.5 166)">
            <path d="M0 -10 C4 -5 4 -1 0 1 C-4 -1 -4 -5 0 -10 Z" fill="#f5c84c" stroke="#e2873b" strokeWidth={1} />
            <path d="M0 -5 C1.6 -3 1.6 -1 0 0 C-1.6 -1 -1.6 -3 0 -5 Z" fill="#fff7d6" />
          </g>

          {/* lid / top board */}
          <S d={rectPath(14, 186, 212, 12, 4)} ink={CASE_INK} base={mix(LACQUER, "#fff", 0.12)} hatch={LACQUER_HATCH} seed={s + 5} gap={3.2} />
          <path d="M22 189.5 H218" stroke="#a69cba" strokeWidth={1} strokeOpacity={0.6} strokeLinecap="round" />
          {/* side cheeks */}
          <S d="M12 192 H24 V222 Q18 224 12 222 Z" ink={CASE_INK} base={LACQUER} hatch={LACQUER_HATCH} seed={s + 6} gap={3} />
          <S d="M216 192 H228 V222 Q222 224 216 222 Z" ink={CASE_INK} base={LACQUER} hatch={LACQUER_HATCH} seed={s + 7} gap={3} />

          {/* keybed */}
          <path d={rectPath(X0, KEY_TOP, X1 - X0, KEY_BOT - KEY_TOP)} fill={IVORY} stroke="#2c2a35" strokeWidth={1.3} />
          {/* pressed-key highlights live under the key lines */}
          {Array.from({ length: POOL }, (_, i) => (
            <rect key={i} ref={c.bag.r("kh" + i)} y={KEY_TOP} width={KW} height={KEY_BOT - KEY_TOP} fill={c.fill} style={{ opacity: 0 }} />
          ))}
          <path d={seps.join(" ")} stroke="#2c2a35" strokeWidth={0.75} strokeOpacity={0.7} />
          <path d={blacks.join(" ")} fill="#2c2a35" />
          {Array.from({ length: POOL }, (_, i) => (
            <rect key={i} ref={c.bag.r("kb" + i)} y={KEY_TOP} width={KW * 0.64} height={BLACK_H} fill={mix(c.fill, "#000000", 0.2)} style={{ opacity: 0 }} />
          ))}
          <S d={rectPath(X0 - 1, KEY_TOP - 1, X1 - X0 + 2, KEY_BOT - KEY_TOP + 2)} ink="#2c2a35" seed={s + 8} w={1.5} />

          {/* key slip + knee board with a carved panel */}
          <S d={rectPath(16, 212, 208, 22, 3)} ink={CASE_INK} base={LACQUER} hatch={LACQUER_HATCH} seed={s + 9} gap={3.6} />
          <S d={rectPath(60, 216, 120, 13, 4)} ink="#8f86a3" seed={s + 10} w={1.1} />
          <L d="M74 222 q6 -5 12 0 t12 0 M142 222 q6 -5 12 0 t12 0" ink={GOLD} seed={s + 11} w={1.2} op={0.85} />
          {/* turned legs */}
          <S d="M22 234 h10 q2 4 -1 6 q3 3 0 6 h-8 q-3 -3 0 -6 q-3 -2 -1 -6 Z" ink={CASE_INK} base={LACQUER} hatch={LACQUER_HATCH} seed={s + 12} gap={3} />
          <S d="M208 234 h10 q2 4 -1 6 q3 3 0 6 h-8 q-3 -3 0 -6 q-3 -2 -1 -6 Z" ink={CASE_INK} base={LACQUER} hatch={LACQUER_HATCH} seed={s + 13} gap={3} />
          {/* pedal box + two brass pedals (the right one is the sustain pedal) */}
          <S d={rectPath(98, 234, 44, 6, 1.5)} ink={CASE_INK} base={LACQUER} seed={s + 14} w={1.2} />
          <S d="M104 240 h9 l1 5 h-11 Z" ink={GOLD_INK} base={GOLD} seed={s + 15} w={1} />
          {/* left foot resting beside the soft pedal */}
          <S d={ellipsePath(96, 245, 11, 5.4)} ink={c.ink} base={mix(c.feet, "#f6f0e1", 0.25)} hatch={c.feet} seed={s + 18} gap={2.6} w={1.5} />
          <g ref={c.bag.r("pedal")}>
            <S d="M127 240 h9 l1 5 h-11 Z" ink={GOLD_INK} base={GOLD} seed={s + 16} w={1} />
            {/* right foot on the sustain pedal */}
            <S d={ellipsePath(135, 243, 11, 5.4)} ink={c.ink} base={mix(c.feet, "#f6f0e1", 0.25)} hatch={c.feet} seed={s + 17} gap={2.6} w={1.5} />
          </g>
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
      // this hand's own next note (or chord), not just the part's next onset
      const nx = nextWhere(s, inHand);
      let target: number | null = null;
      let spread = 1;
      if (nx && nx.inSec < 0.22 && (act.length === 0 || nx.inSec < 0.08)) {
        let lo = keyX(nx.pitch);
        let hi = lo;
        for (const u of s.upcoming ?? []) {
          if (u.inSec - nx.inSec > 0.03) break;
          if (!inHand(u.pitch)) continue;
          lo = Math.min(lo, keyX(u.pitch));
          hi = Math.max(hi, keyX(u.pitch));
        }
        target = (lo + hi) / 2;
        spread = clamp((hi - lo) / 16, 1, 2.4);
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
      const nextIn = nx ? nx.inSec : Infinity;
      const prep = nextIn < 0.16 ? Math.sin(Math.PI * (1 - nextIn / 0.16)) * 6 : 0;
      const resting = act.length === 0 && lastAge > 0.6 && nextIn > 0.6;
      const y = KEY_TOP + 5 + press - prep - (resting ? 3 : 0);
      f.arms[h.key] = { hand: { x: m[kx], y }, spread: m[ks], bend: 10, pawRot: h.key === "L" ? 12 : -12 };
      const w = act.length + hit(lastAge, 0.2);
      leanSum += (m[kx] - 120) * w;
      leanW += w;
    }

    // Big chords: lean toward them and sink into the keys.
    const fresh = s.recent.filter((o) => o.age < 0.03).length;
    const big = s.recent.length ? hit(s.recent[0].age, 0.14) * clamp(fresh / 3, 0, 1.6) : 0;
    f.look.lean = leanW > 0 ? clamp((leanSum / leanW) * 0.06 * (1 + big * 0.6), -6.5, 6.5) : 0;
    f.look.dip = clamp(big * 3.2, 0, 4.5);
    f.look.bliss = s.active.some((n) => n.durSec > 1.2 && n.progress > 0.15);

    // Sustain pedal: down for long notes / held chords, up between harmonies.
    const sustained = s.active.some((n) => n.durSec > 0.6) || s.active.length >= 3;
    const want = sustained && s.playing ? 1 : 0;
    m.pedal = (m.pedal ?? 0) + (want - (m.pedal ?? 0)) * approach(f.dt, want ? 0.03 : 0.07);
    c.bag.tf("pedal", `rotate(${(m.pedal * 8).toFixed(2)} 127 240) translate(0 ${(m.pedal * 1.4).toFixed(2)})`);

    // Candle flame flickers (a touch more when the music's loud).
    const fl = 1 + Math.sin(f.t * 9.3) * 0.06 + Math.sin(f.t * 23.1) * 0.04 + big * 0.12;
    c.bag.tf("flame", `translate(199.5 166) rotate(${(Math.sin(f.t * 5.1) * 4 + f.look.lean * 0.8).toFixed(2)}) scale(${(1 / fl).toFixed(3)} ${fl.toFixed(3)})`);
  },
};
