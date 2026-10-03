import { DRUM, drumPiece } from "@/music/instruments";
import { L, S, ellipsePath, hash, mix } from "../sketch";
import { type Pt, approach, clamp } from "../affine";
import { type Frame, type Rig, type RigCtx, hit, strokeLift, wobble } from "./types";

type Piece = "ride" | "hat" | "crash" | "snare" | "tom" | "floor" | "kick";

interface PieceGeo {
  hitAt: Pt;
  /** Hand position relative to the hit point when the stick is down. */
  hand: Pt;
  arm: "L" | "R";
}

const GEO: Record<Exclude<Piece, "kick">, PieceGeo> = {
  ride: { hitAt: { x: 56, y: 121 }, hand: { x: 30, y: 30 }, arm: "L" },
  hat: { hitAt: { x: 50, y: 163 }, hand: { x: 36, y: 12 }, arm: "L" },
  crash: { hitAt: { x: 180, y: 101 }, hand: { x: -26, y: 34 }, arm: "R" },
  snare: { hitAt: { x: 160, y: 183 }, hand: { x: -30, y: -14 }, arm: "R" },
  tom: { hitAt: { x: 118, y: 160 }, hand: { x: 28, y: -12 }, arm: "R" },
  floor: { hitAt: { x: 204, y: 201 }, hand: { x: -32, y: -16 }, arm: "R" },
};

function pieceOf(pitch: number): Piece {
  if (pitch === DRUM.floorTom || pitch === DRUM.lowTom) return "floor";
  const p = drumPiece(pitch);
  switch (p) {
    case "kick":
      return "kick";
    case "snare":
      return "snare";
    case "hat":
      return "hat";
    case "ride":
      return "ride";
    case "crash":
      return "crash";
    case "tom":
      return "tom";
    default:
      return "tom"; // cowbell/tambourine/shaker: struck near the rack tom
  }
}

const STICK = 42;
const HOME: Record<"L" | "R", Piece> = { L: "hat", R: "snare" };

/** Hand + stick tip for an arm on a piece with a given lift. */
function pose(piece: Exclude<Piece, "kick">, arm: "L" | "R", lift: number) {
  const g = GEO[piece];
  // A tom hit with the left hand mirrors the hand offset.
  const off = piece === "tom" && arm === "L" ? { x: -g.hand.x, y: g.hand.y } : g.hand;
  const hand = { x: g.hitAt.x + off.x, y: g.hitAt.y + off.y - lift * 10 };
  // stick direction hand → tip, rotated up by the lift
  const dx = g.hitAt.x - (g.hitAt.x + off.x);
  const dy = g.hitAt.y - (g.hitAt.y + off.y);
  const len = Math.max(Math.hypot(dx, dy), STICK * 0.7);
  const ang = Math.atan2(dy, dx);
  const up = lift * 0.75 * (dx >= 0 ? -1 : 1);
  const tip = { x: hand.x + Math.cos(ang + up) * len, y: hand.y + Math.sin(ang + up) * len };
  return { hand, tip };
}

export const drums: Rig = {
  follow: "world",
  seated: true,
  render(c: RigCtx) {
    const s = hash(c.animal + "drums");
    const shell = "#c8463c";
    const shellHatch = "#e0786d";
    const brass = "#d9a43a";
    const brassInk = "#8a6418";
    const skin = "#fffaf0";
    const ink = "#2c2a35";
    return {
      back: (
        <g>
          {/* stands */}
          <L d="M56 124 L48 246 M50 168 L44 246 M182 104 L198 246" ink="#6d6a75" seed={s + 1} w={1.6} />
          <g ref={c.bag.r("ride")}>
            <S d={ellipsePath(54, 122, 31, 7)} ink={brassInk} base={mix(brass, "#fff", 0.35)} hatch={brass} seed={s + 2} gap={3} />
            <S d={ellipsePath(54, 121, 4, 2)} ink={brassInk} base={brass} seed={s + 3} w={1} />
          </g>
          <g ref={c.bag.r("crash")}>
            <S d={ellipsePath(184, 102, 28, 7)} ink={brassInk} base={mix(brass, "#fff", 0.35)} hatch={brass} seed={s + 4} gap={3} angle={30} />
          </g>
        </g>
      ),
      front: (
        <g>
          {/* hi-hat */}
          <S d={ellipsePath(46, 170, 23, 5)} ink={brassInk} base={mix(brass, "#fff", 0.35)} hatch={brass} seed={s + 5} gap={3} />
          <g ref={c.bag.r("hatTop")}>
            <S d={ellipsePath(46, 165, 23, 5)} ink={brassInk} base={mix(brass, "#fff", 0.45)} hatch={brass} seed={s + 6} gap={3} />
          </g>
          {/* rack tom */}
          <g ref={c.bag.r("tom")}>
            <S d={`M98 160 V176 Q118 184 138 176 V160 Z`} ink={ink} base={mix(shell, "#fff", 0.3)} hatch={shellHatch} seed={s + 7} gap={3.5} />
            <S d={ellipsePath(118, 160, 20, 6)} ink={ink} base={skin} seed={s + 8} w={1.6} />
            <ellipse ref={c.bag.r("tomFx")} cx={118} cy={160} rx={17} ry={4.5} fill={c.fill} style={{ opacity: 0 }} />
          </g>
          {/* kick */}
          <g ref={c.bag.r("kick")}>
            <S d={ellipsePath(120, 214, 33, 32)} ink={ink} base={skin} seed={s + 9} />
            <S d={ellipsePath(120, 214, 33, 32)} ink={ink} hatch={shellHatch} noStroke seed={s + 10} gap={9} />
            <S d={ellipsePath(120, 214, 27, 26)} ink={mix(shell, ink, 0.3)} seed={s + 11} w={1.5} />
            <S d="M120 199 l4 9 10 1 -7 7 2 10 -9 -5 -9 5 2 -10 -7 -7 10 -1 Z" ink={mix(c.ink, "#000", 0.1)} base={c.fill} seed={s + 12} w={1.2} />
            <circle ref={c.bag.r("kickFx")} cx={120} cy={214} r={30} fill={c.fill} style={{ opacity: 0 }} />
          </g>
          <g ref={c.bag.r("boom")} style={{ opacity: 0 }}>
            <L d="M80 240 l-8 4 M78 228 l-10 0 M160 240 l8 4 M162 228 l10 0" ink={ink} seed={s + 13} w={1.6} />
          </g>
          {/* kick pedal + foot */}
          <path d="M146 244 L166 244" stroke={ink} strokeWidth={2} strokeLinecap="round" />
          <g ref={c.bag.r("foot")}>
            <S d={ellipsePath(160, 238, 12, 6)} ink={c.ink} base={c.light} hatch={c.fill} seed={s + 14} gap={3} />
          </g>
          {/* snare */}
          <g ref={c.bag.r("snare")}>
            <S d={`M134 183 V196 Q160 206 186 196 V183 Z`} ink={ink} base="#e8e6ef" hatch="#a9a5b8" seed={s + 15} gap={3} />
            <S d={ellipsePath(160, 183, 26, 7)} ink={ink} base={skin} seed={s + 16} w={1.6} />
            <ellipse ref={c.bag.r("snareFx")} cx={160} cy={183} rx={22} ry={5} fill={c.fill} style={{ opacity: 0 }} />
          </g>
          {/* floor tom */}
          <g ref={c.bag.r("floor")}>
            <S d={`M182 201 V238 Q204 246 226 238 V201 Z`} ink={ink} base={mix(shell, "#fff", 0.3)} hatch={shellHatch} seed={s + 17} gap={3.5} />
            <S d={ellipsePath(204, 201, 22, 6)} ink={ink} base={skin} seed={s + 18} w={1.6} />
            <ellipse ref={c.bag.r("floorFx")} cx={204} cy={201} rx={19} ry={4.5} fill={c.fill} style={{ opacity: 0 }} />
          </g>
        </g>
      ),
      held: (
        <g>
          <line ref={c.bag.r("stickL")} stroke="#8a5a2b" strokeWidth={3.2} strokeLinecap="round" />
          <line ref={c.bag.r("stickR")} stroke="#8a5a2b" strokeWidth={3.2} strokeLinecap="round" />
          <circle ref={c.bag.r("tipL")} r={2.4} fill="#f2e3c6" stroke="#8a5a2b" strokeWidth={1} />
          <circle ref={c.bag.r("tipR")} r={2.4} fill="#f2e3c6" stroke="#8a5a2b" strokeWidth={1} />
        </g>
      ),
    };
  },
  update(c: RigCtx, f: Frame) {
    const { s } = f;
    const m = c.mem;

    // Assign recent hits to arms: preferred arm unless it is already striking something simultaneous.
    const last: Record<"L" | "R", { piece: Exclude<Piece, "kick">; age: number; vel: number } | null> = { L: null, R: null };
    const pieceAge: Partial<Record<Piece, { age: number; vel: number; pitch: number }>> = {};
    // oldest → newest so the newest wins
    for (let i = s.recent.length - 1; i >= 0; i--) {
      const o = s.recent[i];
      const piece = pieceOf(o.pitch);
      pieceAge[piece] = { age: o.age, vel: o.vel, pitch: o.pitch };
      if (piece === "kick") continue;
      let arm = GEO[piece].arm;
      const other = arm === "L" ? "R" : "L";
      const cur = last[arm];
      if (cur && Math.abs(cur.age - o.age) < 0.025 && cur.piece !== piece) arm = other;
      last[arm] = { piece, age: o.age, vel: o.vel };
    }
    // Who plays the next onset?
    let nextArm: "L" | "R" | null = null;
    let nextPiece: Piece | null = null;
    if (s.nextPitch !== null && s.nextOnsetIn < 0.3) {
      nextPiece = pieceOf(s.nextPitch);
      if (nextPiece !== "kick") nextArm = GEO[nextPiece].arm;
    }

    for (const arm of ["L", "R"] as const) {
      const l = last[arm];
      let piece: Exclude<Piece, "kick">;
      if (nextArm === arm && nextPiece && nextPiece !== "kick") piece = nextPiece;
      else if (l && l.age < 1.5) piece = l.piece;
      else piece = HOME[arm] as Exclude<Piece, "kick">;
      const lift = strokeLift(l ? l.age : Infinity, nextArm === arm ? s.nextOnsetIn : Infinity, s.playing ? 0.6 : 0.35);
      const target = pose(piece, arm, lift);
      // Smooth travel between pieces; strike itself is exact because the target already includes lift.
      const kx = "x" + arm;
      const ky = "y" + arm;
      if (m[kx] === undefined) {
        m[kx] = target.hand.x;
        m[ky] = target.hand.y;
      }
      const k = approach(f.dt, 0.03);
      m[kx] += (target.hand.x - m[kx]) * k;
      m[ky] += (target.hand.y - m[ky]) * k;
      const hand = { x: m[kx], y: m[ky] };
      const tip = { x: target.tip.x + (hand.x - target.hand.x), y: target.tip.y + (hand.y - target.hand.y) };
      c.bag.set("stick" + arm, "x1", hand.x);
      c.bag.set("stick" + arm, "y1", hand.y);
      c.bag.set("stick" + arm, "x2", tip.x);
      c.bag.set("stick" + arm, "y2", tip.y);
      c.bag.set("tip" + arm, "cx", tip.x);
      c.bag.set("tip" + arm, "cy", tip.y);
      f.arms[arm] = { hand, bend: 12, pawRot: arm === "L" ? 20 : -20 };
    }

    // Instrument reactions
    const age = (p: Piece) => pieceAge[p]?.age ?? Infinity;
    const vel = (p: Piece) => pieceAge[p]?.vel ?? 0.6;
    c.bag.tf("ride", `rotate(${(wobble(age("ride"), 22, 3.5) * 5 * vel("ride")).toFixed(2)} 54 122)`);
    c.bag.tf("crash", `rotate(${(wobble(age("crash"), 18, 2.2) * 12 * vel("crash")).toFixed(2)} 184 102)`);
    const hatInfo = pieceAge.hat;
    const open = hatInfo && hatInfo.pitch === DRUM.hatOpen && hatInfo.age < 0.5 ? 1 : 0;
    const pedal = hatInfo && hatInfo.pitch === DRUM.hatPedal ? hit(hatInfo.age, 0.08) : 0;
    const hatW = wobble(age("hat"), 30, 7) * 3 * vel("hat");
    c.bag.tf("hatTop", `translate(0 ${(-3 * open + 4 * pedal).toFixed(2)}) rotate(${hatW.toFixed(2)} 46 165)`);
    for (const p of ["snare", "tom", "floor"] as const) {
      const h = hit(age(p), 0.07) * vel(p);
      c.bag.op(p + "Fx", h * 0.55);
      const cx = p === "snare" ? 160 : p === "tom" ? 118 : 204;
      const cy = p === "snare" ? 190 : p === "tom" ? 168 : 220;
      c.bag.tf(p, `translate(${cx} ${cy}) scale(${(1 + 0.05 * h).toFixed(3)} ${(1 - 0.03 * h).toFixed(3)}) translate(${-cx} ${-cy})`);
    }
    const kh = hit(age("kick"), 0.09) * vel("kick");
    c.bag.tf("kick", `translate(120 214) scale(${(1 + 0.045 * kh).toFixed(3)}) translate(-120 -214)`);
    c.bag.op("kickFx", kh * 0.35);
    c.bag.op("boom", clamp(kh * 1.4, 0, 1));
    // Foot: heel stays, toe drops on the kick; lifts in anticipation.
    const kickNext = nextPiece === "kick" ? s.nextOnsetIn : Infinity;
    const footLift = kickNext < 0.15 ? Math.sin(Math.PI * (1 - kickNext / 0.15)) : 0;
    c.bag.tf("foot", `rotate(${(kh * 14 - footLift * 10).toFixed(2)} 150 240)`);

    // Lean toward the busier side; dip on accents.
    const lx = last.L ? hit(last.L.age, 0.3) : 0;
    const rx = last.R ? hit(last.R.age, 0.3) : 0;
    f.look.lean = clamp((rx - lx) * 3 + (age("crash") < 0.3 ? 3 : 0), -5, 5);
    f.look.dip = clamp(kh * 2 + hit(age("crash"), 0.15) * 3, 0, 4);
  },
};
