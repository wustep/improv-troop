import { DRUM, drumPiece } from "@/music/instruments";
import { L, S, ellipsePath, hash, mix } from "../sketch";
import { type Pt, approach, clamp } from "../affine";
import { type Frame, type Rig, type RigCtx, hit, strokeLift, wobble } from "./types";

// A real (open-handed) kit seen from the front. Screen-left arm: hi-hat, crash, rack tom;
// screen-right arm: ride, floor tom, snare — whichever arm is free takes the snare/tom.
// The hi-hat closes on its pedal, the kick beater swings into the head, cymbals wobble.

type Piece = "ride" | "hat" | "crash" | "snare" | "tom" | "floor" | "kick";
type Hand = Exclude<Piece, "kick">;

interface PieceGeo {
  hitAt: Pt;
  /** Where the hand sits relative to the hit point (for the piece's own arm; mirrored for the other). */
  hand: Pt;
  arm: "L" | "R";
}

const HAT = { x: 46, y: 150 };
const CRASH = { x: 54, y: 98 };
const RIDE = { x: 198, y: 134 };
const TOM = { x: 104, y: 158 };
const SNARE = { x: 152, y: 186 };
const FLOOR = { x: 206, y: 206 };
const KICK = { x: 120, y: 214, r: 33 };

const GEO: Record<Hand, PieceGeo> = {
  hat: { hitAt: { x: HAT.x + 8, y: HAT.y - 3 }, hand: { x: 26, y: 22 }, arm: "L" },
  crash: { hitAt: { x: CRASH.x + 8, y: CRASH.y + 2 }, hand: { x: 22, y: 36 }, arm: "L" },
  tom: { hitAt: { x: TOM.x, y: TOM.y }, hand: { x: -22, y: 16 }, arm: "L" },
  ride: { hitAt: { x: RIDE.x - 10, y: RIDE.y + 1 }, hand: { x: -14, y: 32 }, arm: "R" },
  snare: { hitAt: { x: SNARE.x - 2, y: SNARE.y }, hand: { x: 26, y: -10 }, arm: "R" },
  floor: { hitAt: { x: FLOOR.x - 2, y: FLOOR.y }, hand: { x: -24, y: -18 }, arm: "R" },
};

function pieceOf(pitch: number): Piece {
  if (pitch === DRUM.floorTom || pitch === DRUM.lowTom) return "floor";
  switch (drumPiece(pitch)) {
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
    default:
      return "tom"; // toms, plus cowbell/tambourine/shaker struck near the rack tom
  }
}

const STICK = 40;
const HOME: Record<"L" | "R", Hand> = { L: "hat", R: "snare" };

/** Hand + stick tip for an arm on a piece with a given lift. */
function pose(piece: Hand, arm: "L" | "R", lift: number) {
  const g = GEO[piece];
  const off = arm === g.arm ? g.hand : { x: -g.hand.x, y: g.hand.y };
  const hand = { x: g.hitAt.x + off.x, y: g.hitAt.y + off.y - lift * 10 };
  const dx = -off.x;
  const dy = -off.y;
  const len = Math.max(Math.hypot(dx, dy), STICK * 0.7);
  const ang = Math.atan2(dy, dx);
  const up = lift * 0.75 * (dx >= 0 ? -1 : 1);
  const tip = { x: hand.x + Math.cos(ang + up) * len, y: hand.y + Math.sin(ang + up) * len };
  return { hand, tip };
}

/** A drum shell (front view): body + top head + optional hoop lugs. */
function shellPath(cx: number, top: number, rx: number, h: number, ry: number) {
  return `M${cx - rx} ${top} V${top + h} Q${cx} ${top + h + ry * 1.6} ${cx + rx} ${top + h} V${top} Z`;
}

export const drums: Rig = {
  follow: "world",
  seated: true,
  hideFeet: true,
  render(c: RigCtx) {
    const s = hash(c.animal + "drums");
    const shell = "#c8463c";
    const shellHatch = "#e0786d";
    const brass = "#d9a43a";
    const brassInk = "#8a6418";
    const skin = "#fffaf0";
    const chrome = "#8f8b99";
    const ink = "#2c2a35";
    const foot = (x: number, y: number, seed: number) => (
      <S d={ellipsePath(x, y, 11, 5.4)} ink={c.ink} base={mix(c.feet, "#f6f0e1", 0.25)} hatch={c.feet} seed={seed} gap={2.6} w={1.5} />
    );
    return {
      back: (
        <g>
          {/* cymbal stands: crash (left boom), ride (right) */}
          <L d={`M${CRASH.x} ${CRASH.y + 3} L30 238 M30 226 L18 248 M30 226 L42 248`} ink={chrome} seed={s + 1} w={1.7} />
          <L d={`M${RIDE.x} ${RIDE.y + 3} L214 238 M214 226 L202 248 M214 226 L228 248`} ink={chrome} seed={s + 2} w={1.7} />
          <g ref={c.bag.r("crash")}>
            <S d={ellipsePath(CRASH.x, CRASH.y, 27, 6.5)} ink={brassInk} base={mix(brass, "#fff", 0.35)} hatch={brass} seed={s + 3} gap={3} angle={30} />
            <S d={ellipsePath(CRASH.x, CRASH.y - 0.5, 3.5, 1.8)} ink={brassInk} base={brass} seed={s + 4} w={1} />
          </g>
          <g ref={c.bag.r("ride")}>
            <S d={ellipsePath(RIDE.x, RIDE.y, 31, 7)} ink={brassInk} base={mix(brass, "#fff", 0.35)} hatch={brass} seed={s + 5} gap={3} />
            <S d={ellipsePath(RIDE.x, RIDE.y - 0.5, 5, 2.3)} ink={brassInk} base={brass} seed={s + 6} w={1} />
          </g>
        </g>
      ),
      front: (
        <g>
          {/* ── hi-hat: stand, pedal, foot, two cymbals ── */}
          <L d={`M${HAT.x} ${HAT.y} V236 M${HAT.x} 226 L${HAT.x - 13} 248 M${HAT.x} 226 L${HAT.x + 13} 248`} ink={chrome} seed={s + 7} w={1.7} />
          <g ref={c.bag.r("hatPedal")}>
            <path d={`M${HAT.x - 14} 243 L${HAT.x + 10} 239`} stroke={ink} strokeWidth={3} strokeLinecap="round" />
            {foot(HAT.x - 4, 239, s + 8)}
          </g>
          <S d={ellipsePath(HAT.x, HAT.y + 3, 22, 4.5)} ink={brassInk} base={mix(brass, "#fff", 0.3)} hatch={brass} seed={s + 9} gap={3} />
          <g ref={c.bag.r("hatTop")}>
            <S d={ellipsePath(HAT.x, HAT.y - 2, 22, 4.5)} ink={brassInk} base={mix(brass, "#fff", 0.45)} hatch={brass} seed={s + 10} gap={3} />
            <path d={`M${HAT.x} ${HAT.y - 9} V${HAT.y - 2}`} stroke={chrome} strokeWidth={1.6} strokeLinecap="round" />
          </g>

          {/* ── floor tom on its legs ── */}
          <L d={`M${FLOOR.x - 16} 226 L${FLOOR.x - 20} 248 M${FLOOR.x + 16} 226 L${FLOOR.x + 22} 248`} ink={chrome} seed={s + 11} w={1.8} />
          <g ref={c.bag.r("floor")}>
            <S d={shellPath(FLOOR.x, FLOOR.y, 21, 26, 6)} ink={ink} base={mix(shell, "#fff", 0.3)} hatch={shellHatch} seed={s + 12} gap={3.5} />
            <L d={`M${FLOOR.x - 14} ${FLOOR.y + 4} v18 M${FLOOR.x} ${FLOOR.y + 6} v20 M${FLOOR.x + 14} ${FLOOR.y + 4} v18`} ink={mix(shell, ink, 0.4)} seed={s + 13} w={1} />
            <S d={ellipsePath(FLOOR.x, FLOOR.y, 21, 6)} ink={ink} base={skin} seed={s + 14} w={1.6} />
            <ellipse ref={c.bag.r("floorFx")} cx={FLOOR.x} cy={FLOOR.y} rx={18} ry={4.5} fill={c.fill} style={{ opacity: 0 }} />
          </g>

          {/* ── kick pedal peeking out on the floor, foot on it ── */}
          <path d="M150 245 L176 240" stroke={ink} strokeWidth={3} strokeLinecap="round" />
          <g ref={c.bag.r("kickFoot")}>{foot(167, 239, s + 16)}</g>

          {/* ── kick drum (front head with the band logo) ── */}
          <L d={`M${KICK.x - 26} 238 L${KICK.x - 36} 248 M${KICK.x + 26} 238 L${KICK.x + 36} 248`} ink={chrome} seed={s + 17} w={1.8} />
          <g ref={c.bag.r("kick")}>
            <S d={ellipsePath(KICK.x, KICK.y, KICK.r, KICK.r - 1)} ink={ink} base={skin} seed={s + 18} />
            <S d={ellipsePath(KICK.x, KICK.y, KICK.r, KICK.r - 1)} ink={ink} hatch={shellHatch} noStroke seed={s + 19} gap={9} />
            <S d={ellipsePath(KICK.x, KICK.y, KICK.r - 6, KICK.r - 7)} ink={mix(shell, ink, 0.3)} seed={s + 20} w={1.5} />
            {/* tension lugs around the hoop */}
            <path
              d={Array.from({ length: 10 }, (_, i) => {
                const a = (i / 10) * Math.PI * 2;
                const x = KICK.x + Math.cos(a) * (KICK.r + 1);
                const y = KICK.y + Math.sin(a) * (KICK.r);
                return `M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * 3).toFixed(1)} ${(Math.sin(a) * 3).toFixed(1)}`;
              }).join(" ")}
              stroke={chrome}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <S d="M120 199 l4 9 10 1 -7 7 2 10 -9 -5 -9 5 2 -10 -7 -7 10 -1 Z" ink={mix(c.ink, "#000", 0.1)} base={c.fill} seed={s + 21} w={1.2} />
            {/* port hole in the front head: you can see the beater thump through it */}
            <circle cx={KICK.x + 15} cy={KICK.y + 16} r={7} fill="#3a3340" stroke={ink} strokeWidth={1.4} />
            <g ref={c.bag.r("beater")}>
              <circle cx={KICK.x + 15} cy={KICK.y + 16} r={3.6} fill="#f2e3c6" stroke="#8a7a5a" strokeWidth={1} />
            </g>
            <circle ref={c.bag.r("kickFx")} cx={KICK.x} cy={KICK.y} r={30} fill={c.fill} style={{ opacity: 0 }} />
          </g>
          <g ref={c.bag.r("boom")} style={{ opacity: 0 }}>
            <L d="M80 240 l-8 4 M78 228 l-10 0 M160 222 l10 -2 M163 232 l9 2" ink={ink} seed={s + 22} w={1.6} />
          </g>

          {/* ── rack tom on its mount ── */}
          <L d={`M${TOM.x + 6} 183 L${TOM.x + 2} 172`} ink={chrome} seed={s + 23} w={2.2} />
          <g ref={c.bag.r("tom")}>
            <S d={shellPath(TOM.x, TOM.y, 18, 13, 5)} ink={ink} base={mix(shell, "#fff", 0.3)} hatch={shellHatch} seed={s + 24} gap={3.5} />
            <S d={ellipsePath(TOM.x, TOM.y, 18, 5.5)} ink={ink} base={skin} seed={s + 25} w={1.6} />
            <ellipse ref={c.bag.r("tomFx")} cx={TOM.x} cy={TOM.y} rx={15} ry={4} fill={c.fill} style={{ opacity: 0 }} />
          </g>

          {/* ── snare on its basket stand ── */}
          <L d={`M${SNARE.x} ${SNARE.y + 14} V228 M${SNARE.x} 228 L${SNARE.x - 12} 248 M${SNARE.x} 228 L${SNARE.x + 12} 248`} ink={chrome} seed={s + 26} w={1.6} />
          <g ref={c.bag.r("snare")}>
            <S d={shellPath(SNARE.x, SNARE.y, 24, 11, 6)} ink={ink} base="#e8e6ef" hatch="#a9a5b8" seed={s + 27} gap={3} />
            <L d={`M${SNARE.x - 20} ${SNARE.y + 2} v8 M${SNARE.x - 7} ${SNARE.y + 3} v9 M${SNARE.x + 7} ${SNARE.y + 3} v9 M${SNARE.x + 20} ${SNARE.y + 2} v8`} ink={chrome} seed={s + 28} w={1.2} />
            <S d={ellipsePath(SNARE.x, SNARE.y, 24, 6.5)} ink={ink} base={skin} seed={s + 29} w={1.6} />
            {/* rim */}
            <path d={`M${SNARE.x - 24} ${SNARE.y} Q${SNARE.x} ${SNARE.y + 9} ${SNARE.x + 24} ${SNARE.y}`} stroke={chrome} strokeWidth={1.6} fill="none" />
            <ellipse ref={c.bag.r("snareFx")} cx={SNARE.x} cy={SNARE.y} rx={20} ry={4.6} fill={c.fill} style={{ opacity: 0 }} />
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

    // Assign recent hits to arms: the piece's own arm unless it's already striking something else at that moment.
    const last: Record<"L" | "R", { piece: Hand; age: number; vel: number } | null> = { L: null, R: null };
    const pieceAge: Partial<Record<Piece, { age: number; vel: number; pitch: number }>> = {};
    for (let i = s.recent.length - 1; i >= 0; i--) {
      const o = s.recent[i];
      const piece = pieceOf(o.pitch);
      pieceAge[piece] = { age: o.age, vel: o.vel, pitch: o.pitch };
      if (piece === "kick") continue;
      // pedal hi-hat is played by the foot, not a stick
      if (o.pitch === DRUM.hatPedal) continue;
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
      if (nextPiece !== "kick" && s.nextPitch !== DRUM.hatPedal) {
        nextArm = GEO[nextPiece].arm;
        // the snare/tom goes to whichever hand is free
        const busy = last[nextArm];
        if ((nextPiece === "snare" || nextPiece === "tom") && busy && busy.piece !== nextPiece && busy.age < 0.12) nextArm = nextArm === "L" ? "R" : "L";
      }
    }

    for (const arm of ["L", "R"] as const) {
      const l = last[arm];
      let piece: Hand;
      if (nextArm === arm && nextPiece && nextPiece !== "kick") piece = nextPiece as Hand;
      else if (l && l.age < 1.5) piece = l.piece;
      else piece = HOME[arm];
      const lift = strokeLift(l ? l.age : Infinity, nextArm === arm ? s.nextOnsetIn : Infinity, s.playing ? 0.6 : 0.35);
      const target = pose(piece, arm, lift);
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
      f.arms[arm] = { hand, bend: 14, pawRot: arm === "L" ? 20 : -20 };
    }

    // ── instrument reactions ──
    const age = (p: Piece) => pieceAge[p]?.age ?? Infinity;
    const vel = (p: Piece) => pieceAge[p]?.vel ?? 0.6;
    c.bag.tf("ride", `rotate(${(wobble(age("ride"), 22, 3.5) * 5 * vel("ride")).toFixed(2)} ${RIDE.x} ${RIDE.y})`);
    c.bag.tf("crash", `rotate(${(wobble(age("crash"), 18, 2.2) * 12 * vel("crash")).toFixed(2)} ${CRASH.x} ${CRASH.y})`);

    // Hi-hat: closed while the foot is down (closed-hat strokes, pedal chicks), open on 46.
    const hat = pieceAge.hat;
    const hatAge = hat ? hat.age : Infinity;
    const pedalChick = hat && hat.pitch === DRUM.hatPedal ? hit(hat.age, 0.1) : 0;
    const closedHold = hat && hat.pitch === DRUM.hatClosed && hat.age < 0.6 ? 1 : 0;
    const openWide = hat && hat.pitch === DRUM.hatOpen && hat.age < 0.5 ? 1 : 0;
    // foot comes down just before a pedal chick
    const pedalNext = s.nextPitch === DRUM.hatPedal ? s.nextOnsetIn : Infinity;
    const anticip = pedalNext < 0.12 ? 1 - pedalNext / 0.12 : 0;
    const closure = clamp(Math.max(pedalChick, closedHold * 0.9, anticip * 0.8) - openWide, 0, 1);
    m.hatClose = (m.hatClose ?? 0) + (closure - (m.hatClose ?? 0)) * approach(f.dt, 0.015);
    const hatW = hat && hat.pitch !== DRUM.hatPedal ? wobble(hatAge, 30, 7) * 3 * vel("hat") : 0;
    c.bag.tf("hatTop", `translate(0 ${(m.hatClose * 4.5 - openWide * 2.5).toFixed(2)}) rotate(${hatW.toFixed(2)} ${HAT.x} ${HAT.y})`);
    c.bag.tf("hatPedal", `rotate(${(m.hatClose * 9).toFixed(2)} ${HAT.x - 14} 243)`);

    // Snare / toms bounce and flash.
    for (const p of ["snare", "tom", "floor"] as const) {
      const h = hit(age(p), 0.07) * vel(p);
      c.bag.op(p + "Fx", h * 0.55);
      const geo = p === "snare" ? SNARE : p === "tom" ? TOM : FLOOR;
      const cx = geo.x;
      const cy = geo.y + 6;
      c.bag.tf(p, `translate(${cx} ${cy}) scale(${(1 + 0.05 * h).toFixed(3)} ${(1 - 0.03 * h).toFixed(3)}) translate(${-cx} ${-cy})`);
    }

    // Kick: the beater swings into the head as the foot presses; pulls back just before.
    const kh = hit(age("kick"), 0.09) * vel("kick");
    const kickNext = nextPiece === "kick" ? s.nextOnsetIn : Infinity;
    const windup = kickNext < 0.15 ? Math.sin(Math.PI * 0.5 * (1 - kickNext / 0.15)) : 0;
    const strike = hit(age("kick"), 0.06);
    // seen through the port: pulls back (smaller) on the wind-up, swells as it hits the head
    const bs = clamp(0.75 - windup * 0.35 + strike * 0.65, 0.35, 1.5);
    const bx = KICK.x + 15;
    const by = KICK.y + 16;
    c.bag.tf("beater", `translate(${bx} ${by}) scale(${bs.toFixed(3)}) translate(${-bx} ${-by})`);
    c.bag.tf("kickFoot", `rotate(${(strike * 12 - windup * 9).toFixed(2)} 162 241)`);
    c.bag.tf("kick", `translate(${KICK.x} ${KICK.y}) scale(${(1 + 0.045 * kh).toFixed(3)}) translate(${-KICK.x} ${-KICK.y})`);
    c.bag.op("kickFx", kh * 0.35);
    c.bag.op("boom", clamp(kh * 1.4, 0, 1));

    // Lean toward the busier side; dip on accents.
    const lx = last.L ? hit(last.L.age, 0.3) : 0;
    const rx = last.R ? hit(last.R.age, 0.3) : 0;
    f.look.lean = clamp((rx - lx) * 3 + (age("crash") < 0.3 ? -3 : 0), -5, 5);
    f.look.dip = clamp(kh * 2 + hit(age("crash"), 0.15) * 3, 0, 4);
  },
};
