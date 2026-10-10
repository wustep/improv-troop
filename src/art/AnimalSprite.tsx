"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import type { AnimalId, InstrumentId, MemberFrameState } from "@/music/types";
import { ANIMALS, INSTRUMENTS } from "@/music/instruments";
import { ANCHOR, Blush, animalArt, mouthPath } from "./animals";
import { L, PENCIL, S, ellipsePath, hash, mix, tint } from "./sketch";
import { type Pt, approach, attr, clamp } from "./affine";
import { Motion, randAt } from "./motion";
import { RIGS } from "./rigs";
import { Bag, type Frame, type RigCtx } from "./rigs/types";

export interface SpriteHandle {
  /**
   * Draw one frame. `clock` (seconds) replaces the wall clock, so a frame can be stepped and
   * replayed exactly (the art lab's scrubber); `reset` forgets the last frame's time first.
   */
  update(state: MemberFrameState, clock?: { t: number; reset?: boolean }): void;
  /** Where the paws were last drawn (viewBox units), for spotting crossed or teleporting arms. */
  hands(): Record<"L" | "R", Pt>;
  /** Where the shoulders were last drawn: the body leans, dips and bows, so they move too. */
  shoulders(): Record<"L" | "R", Pt>;
  /** The take just ended: a happy little hop, eyes squeezed shut. */
  cheer(): void;
}


export interface AnimalSpriteProps {
  animal: AnimalId;
  instrument: InstrumentId;
  name?: string;
  /** Rendered width in px (height follows the 240×270 aspect). */
  size?: number;
  className?: string;
}

const VB_W = 240;
const VB_H = 270;

/**
 * Is this player in the middle of a phrase: a note sounding, one just played, or one about to
 * land? A soloist's spotlight and sparkles dim in the gaps between phrases, so the solo is seen
 * to breathe the way it's heard to.
 */
export function isPhrasing(s: MemberFrameState): boolean {
  return s.active.length > 0 || (s.recent[0]?.age ?? Infinity) < 0.6 || s.nextOnsetIn < 0.35;
}

export const IDLE_STATE: MemberFrameState = {
  playing: false,
  beat: 0,
  beatPhase: 0,
  bpm: 100,
  beatsPerBar: 4,
  active: [],
  recent: [],
  nextOnsetIn: Infinity,
  nextPitch: null,
  role: "rest",
  energy: 0.3,
  featured: false,
};

const SPARKS: Pt[] = [
  { x: 58, y: 58 },
  { x: 186, y: 64 },
  { x: 196, y: 132 },
];

/** Elbow control point: the arm bows outward, more when the hand is close to the shoulder. */
function elbow(s: Pt, h: Pt, side: -1 | 1, bend: number): Pt {
  const dx = h.x - s.x;
  const dy = h.y - s.y;
  const d = Math.hypot(dx, dy) || 1;
  let px = -dy / d;
  let py = dx / d;
  if (side * px + 0.6 * py < 0) {
    px = -px;
    py = -py;
  }
  const amt = Math.abs(bend) + Math.max(0, 62 - d) * 0.45;
  return { x: (s.x + h.x) / 2 + px * amt, y: (s.y + h.y) / 2 + py * amt };
}

const ARM_SAMPLES = 8;
const f1 = (n: number) => n.toFixed(1);

/** Smooth a polyline with quadratic midpoints (keeps the doodle soft, not polygonal). */
function smooth(pts: Pt[], start = true): string {
  let d = start ? `M${f1(pts[0].x)} ${f1(pts[0].y)}` : `L${f1(pts[0].x)} ${f1(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${f1(pts[i].x)} ${f1(pts[i].y)} ${f1(mx)} ${f1(my)}`;
  }
  const e = pts[pts.length - 1];
  return d + ` L${f1(e.x)} ${f1(e.y)}`;
}

/**
 * A chubby, tapered limb from shoulder to hand along a soft quadratic elbow:
 * fill (closed), outline (open at the shoulder so it melts into the body), hatch strokes.
 */
function armShape(s: Pt, h: Pt, side: -1 | 1, bend: number) {
  const c = elbow(s, h, side, bend);
  const left: Pt[] = [];
  const right: Pt[] = [];
  const hatch: string[] = [];
  let tx = 0;
  let ty = 0;
  for (let i = 0; i <= ARM_SAMPLES; i++) {
    const t = i / ARM_SAMPLES;
    const u = 1 - t;
    const x = u * u * s.x + 2 * u * t * c.x + t * t * h.x;
    const y = u * u * s.y + 2 * u * t * c.y + t * t * h.y;
    tx = 2 * u * (c.x - s.x) + 2 * t * (h.x - c.x);
    ty = 2 * u * (c.y - s.y) + 2 * t * (h.y - c.y);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // shoulder 7.2 → wrist 4.6, with a soft forearm swell
    const w = 7.2 - 2.6 * t + 0.7 * Math.sin(Math.PI * t);
    left.push({ x: x - ty * w, y: y + tx * w });
    right.push({ x: x + ty * w, y: y - tx * w });
    if (i === 2 || i === 4 || i === 6) {
      const k = w * 0.62;
      hatch.push(`M${f1(x - ty * k - tx * 2)} ${f1(y + tx * k - ty * 2)} L${f1(x + ty * k + tx * 2)} ${f1(y - tx * k + ty * 2)}`);
    }
  }
  const L = left[left.length - 1];
  const R = right[right.length - 1];
  const capW = 4.6 * 1.25;
  const cap = ` Q${f1((L.x + R.x) / 2 + tx * capW)} ${f1((L.y + R.y) / 2 + ty * capW)} ${f1(R.x)} ${f1(R.y)}`;
  const rev = [...right].reverse();
  const sideL = smooth(left);
  const outline = sideL + cap + " " + smooth(rev, false);
  return { fill: outline + " Z", outline, hatch: hatch.join(" ") };
}

export const AnimalSprite = forwardRef<SpriteHandle, AnimalSpriteProps>(function AnimalSprite(
  { animal, instrument, name, size = 240, className },
  ref,
) {
  const def = ANIMALS[animal];
  const art = animalArt(animal);
  const rig = RIGS[instrument];

  const ctx = useMemo<RigCtx>(
    () => ({
      bag: new Bag(),
      animal,
      ink: def.ink,
      fill: def.fill,
      light: tint(def.fill, 0.35),
      feet: art.feet ?? def.fill,
      seed: hash(animal + instrument),
      mouth: art.face.mouth,
      mem: {},
    }),
    [animal, instrument, def, art],
  );
  const parts = useMemo(() => rig.render(ctx), [rig, ctx]);
  const me = useMemo(() => new Bag(), []);

  const motion = useMemo(
    () => new Motion({ follow: rig.follow, seated: !!rig.seated, ears: art.ears?.[0].kind ?? null, tail: art.tail?.kind ?? null, seed: hash(animal) }),
    [rig, art, animal],
  );

  const rt = useRef({
    last: 0,
    lastExternal: -1,
    state: IDLE_STATE as MemberFrameState,
    blinkAt: 1.5 + (hash(animal) % 1000) / 400,
    lastCue: -Infinity,
    gaze: { x: 0, y: 0 },
    glow: 0,
    oh: 0,
    brow: 0,
    browUp: 0,
    hands: { L: { x: 100, y: 205 }, R: { x: 140, y: 205 } } as Record<"L" | "R", Pt>,
    shoulders: { L: { ...ANCHOR.shoulderL }, R: { ...ANCHOR.shoulderR } } as Record<"L" | "R", Pt>,
  });

  const step = useMemo(() => {
    return (s: MemberFrameState, clock?: { t: number; reset?: boolean }) => {
      const r = rt.current;
      const t = clock ? clock.t : performance.now() / 1000;
      if (clock?.reset) r.last = 0;
      const dt = r.last ? clamp(t - r.last, 0, 0.1) : 0.016;
      r.last = t;
      const playing = s.playing;
      const energy = clamp(s.energy, 0, 1);

      // ── body & head (uses last frame's lean/dip from the rig) ──
      const pose = motion.pose(s, t, dt);
      me.tf("char", attr(pose.charM));
      me.tf("body", attr(pose.bodyM));
      me.tf("head", attr(pose.headM));
      me.tf("instFront", attr(pose.M));
      me.tf("instBack", attr(pose.M));
      // ears behind the head, the tail behind the body: they swing about where they're attached
      if (art.ears) {
        for (const i of [0, 1] as const) {
          const e = art.ears[i];
          const sign = i === 0 ? -1 : 1;
          const flap = 1 + pose.earFlap;
          me.tf("ear" + i, `rotate(${(sign * pose.ears[i]).toFixed(2)} ${e.pivot.x} ${e.pivot.y})${e.kind === "flap" ? ` translate(${e.pivot.x} ${e.pivot.y}) scale(${flap.toFixed(3)} 1) translate(${-e.pivot.x} ${-e.pivot.y})` : ""}`);
        }
      }
      if (art.tail) me.tf("tail", `rotate(${pose.tail.toFixed(2)} ${art.tail.pivot.x} ${art.tail.pivot.y})`);

      const f: Frame = {
        s,
        t,
        dt,
        M: pose.M,
        arms: { L: { hand: r.hands.L, bend: 12 }, R: { hand: r.hands.R, bend: 12 } },
        look: { mouthCovered: false, cheeks: 0, inhale: 0, bliss: false, lean: 0, dip: 0 },
      };
      rig.update(ctx, f);
      motion.settle(f.look, dt);

      // ── arms ──
      for (const side of ["L", "R"] as const) {
        const a = f.arms[side];
        r.hands[side] = a.hand;
        const sh = pose.shoulders[side];
        r.shoulders[side] = sh;
        const arm = armShape(sh, a.hand, side === "L" ? -1 : 1, a.bend ?? 12);
        me.set("armFill" + side, "d", arm.fill);
        me.set("arm" + side, "d", arm.outline);
        me.set("armHatch" + side, "d", arm.hatch);
        const spread = a.spread ?? 1;
        me.tf("paw" + side, `translate(${a.hand.x.toFixed(1)} ${a.hand.y.toFixed(1)}) rotate(${(a.pawRot ?? 0).toFixed(1)}) scale(${spread.toFixed(2)} 1)`);
        me.op("paw" + side, a.hidePaw ? 0 : 1);
      }

      // ── face ──
      const [e1, e2] = art.face.eyes;
      // a blink now and then, and one with every turn of the head or reaction
      if (motion.blinkCue > r.lastCue) {
        r.lastCue = motion.blinkCue;
        if (t - r.blinkAt > 0.4 || t < r.blinkAt) r.blinkAt = Math.min(r.blinkAt, t);
      }
      let blink = 1;
      if (t < r.blinkAt - 6) r.blinkAt = t + 1 + randAt(t) * 2; // the clock went back (a replay)
      if (t > r.blinkAt) {
        const p = (t - r.blinkAt) / 0.15;
        // the next blink, pseudo-random from the time so a replayed frame blinks the same
        if (p >= 1) r.blinkAt = t + 2.2 + randAt(t) * 3.2;
        // shut quickly, open a little slower
        else blink = p < 0.4 ? 1 - p / 0.4 : (p - 0.4) / 0.6;
      }
      const open = Math.max(0.08, blink) * (1 - pose.happy) * (1 - 0.3 * pose.soft);
      // the pupils go where the hands are working, or across the stage at the soloist. They jump
      // there and hold (a saccade), rather than drifting with every move of the paws.
      const hx = (r.hands.L.x + r.hands.R.x) / 2 - 120;
      const hy = (r.hands.L.y + r.hands.R.y) / 2 - 110;
      const gl = Math.hypot(hx, hy) || 1;
      const g = Math.abs(pose.eyeTurn);
      const want = { x: (hx / gl) * 1.4 * (1 - g) + pose.eyeTurn * 2.6, y: (hy / gl) * 1.4 * (1 - g) - g * 0.6 };
      if (Math.hypot(want.x - r.gaze.x, want.y - r.gaze.y) > 0.45 || g > 0.05) {
        r.gaze.x += (want.x - r.gaze.x) * approach(dt, 0.03);
        r.gaze.y += (want.y - r.gaze.y) * approach(dt, 0.03);
      }
      const gx = r.gaze.x;
      const gy = r.gaze.y;
      me.tf("eyeL", `translate(${(e1.x + gx).toFixed(2)} ${(e1.y + gy).toFixed(2)}) scale(1 ${open.toFixed(3)})`);
      me.tf("eyeR", `translate(${(e2.x + gx).toFixed(2)} ${(e2.y + gy).toFixed(2)}) scale(1 ${open.toFixed(3)})`);
      me.op("shut", pose.happy);

      // ── expressions: an "o" on big accents, a focused brow on fast passages, brows up for a high note ──
      const newest = s.recent[0];
      const accent = playing && newest !== undefined && newest.age < 0.35 && newest.vel >= 0.86;
      const peak = playing && s.featured && energy >= 0.88 && s.active.length > 0;
      const wantOh = !f.look.mouthCovered && (accent || peak) && pose.grin < 0.1 ? 1 : 0;
      r.oh += (wantOh - r.oh) * approach(dt, wantOh ? 0.04 : 0.16);
      let quick = 0;
      for (const o of s.recent) if (o.age < 0.7) quick++;
      const focus = playing && quick >= 5 && motion.bliss < 0.5 ? 1 : 0;
      // a soloist reaching for the top of their range lifts their brows with it
      const top = INSTRUMENTS[instrument].solo?.[1] ?? INSTRUMENTS[instrument].sweet[1];
      const high = playing && s.featured && s.active.length > 0 && s.active[0].pitch >= top - 4 ? 1 : 0;
      const up = Math.max(wantOh, high);
      r.brow += (Math.max(focus, up) - r.brow) * approach(dt, 0.12);
      r.browUp += (up - r.browUp) * approach(dt, 0.06);
      me.op("brows", r.brow * 0.85 * (1 - motion.bliss) * (1 - pose.happy));
      const by = (-2.6 * r.browUp).toFixed(2);
      const ba = (7 * (1 - r.browUp)).toFixed(1);
      const er = art.face.eyeR;
      me.tf("browL", `translate(${(e1.x + gx * 0.4).toFixed(1)} ${(e1.y - er * 2.3).toFixed(1)}) translate(0 ${by}) rotate(${ba})`);
      me.tf("browR", `translate(${(e2.x + gx * 0.4).toFixed(1)} ${(e2.y - er * 2.3).toFixed(1)}) translate(0 ${by}) rotate(-${ba})`);
      // a grin for the cheer and the end of a bow (not round a mouthpiece)
      const grin = f.look.mouthCovered ? 0 : pose.grin;
      me.op("grin", grin);
      me.op("oh", r.oh * (f.look.mouthCovered ? 0 : 1) * (1 - grin));
      me.op("mouth", f.look.mouthCovered ? 0 : (1 - r.oh) * (1 - grin));
      const ch = motion.cheeks;
      me.op("cheeks", ch > 0.02 ? 1 : 0);
      const cs = (0.35 + 0.65 * ch).toFixed(3);
      me.tf("cheekL", `translate(${art.face.mouth.x - 15} ${art.face.mouth.y - 1}) scale(${cs})`);
      me.tf("cheekR", `translate(${art.face.mouth.x + 15} ${art.face.mouth.y - 1}) scale(${cs})`);

      // ── feet: a tap that lifts through the back of the beat and lands on it; steps along the instrument ──
      if (!rig.hideFeet) {
        me.tf("footL", `rotate(${pose.feet[0].toFixed(2)} ${ANCHOR.footL.x + 10} ${ANCHOR.footL.y + 4})`);
        me.tf("footR", `rotate(${(-pose.feet[1]).toFixed(2)} ${ANCHOR.footR.x - 10} ${ANCHOR.footR.y + 4})`);
      }

      // ── soloist sparkles ──
      // full while phrasing, a faint glimmer while the soloist breathes (eased, so choppy lines don't flicker)
      const wantGlow = (s.featured ? 1 : 0) * (isPhrasing(s) ? 1 : 0.25);
      r.glow += (wantGlow - r.glow) * approach(dt, 0.15);
      for (let i = 0; i < SPARKS.length; i++) {
        const tw = r.glow > 0.01 ? r.glow * (0.45 + 0.55 * Math.sin(t * 4.2 + i * 2.1)) : 0;
        me.op("spark" + i, Math.max(0, tw));
        me.tf("spark" + i, `translate(${SPARKS[i].x} ${SPARKS[i].y}) scale(${(0.7 + 0.4 * Math.max(0, tw)).toFixed(2)}) rotate(${((t * 40 + i * 60) % 360).toFixed(1)})`);
      }
    };
  }, [ctx, rig, me, art, motion, instrument]);

  useImperativeHandle(
    ref,
    () => ({
      cheer() {
        motion.cheer(rt.current.last || performance.now() / 1000);
      },
      update(state: MemberFrameState, clock?: { t: number; reset?: boolean }) {
        rt.current.lastExternal = performance.now();
        rt.current.state = state;
        step(state, clock);
      },
      hands() {
        return { L: { ...rt.current.hands.L }, R: { ...rt.current.hands.R } };
      },
      shoulders() {
        return { L: { ...rt.current.shoulders.L }, R: { ...rt.current.shoulders.R } };
      },
    }),
    [step, motion],
  );

  // Arms and instrument placement are posed per frame, so the server-rendered sprite is only
  // half drawn: pose it once before the first paint, then show it.
  const svgRef = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    step(rt.current.lastExternal < 0 ? IDLE_STATE : rt.current.state);
    if (svgRef.current) svgRef.current.style.opacity = "1";
  }, [step]);

  // Stay alive (breathing, blinking) when nobody is driving us.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const r = rt.current;
      const since = performance.now() - r.lastExternal;
      if (since > 150) {
        // Not driven: settle into idle, letting old onsets age naturally.
        const e = since / 1000;
        step(
          r.lastExternal < 0
            ? IDLE_STATE
            : { ...r.state, playing: false, active: [], nextOnsetIn: Infinity, nextPitch: null, upcoming: [], recent: r.state.recent.map((o) => ({ ...o, age: o.age + e })) },
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const { ink, fill } = def;
  const eyeR0 = art.face.eyeR;
  const feet = art.feet ?? fill;
  const sd = hash(animal + "sprite");
  const mp = mouthPath(art.face.mouthStyle, art.face.mouth);
  const eyeR = art.face.eyeR;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={size}
      height={(size * VB_H) / VB_W}
      ref={svgRef}
      className={className}
      style={{ overflow: "visible", opacity: 0, transition: "opacity 160ms ease-out" }}
      role="img"
      aria-label={`${name ?? def.name} the ${def.species} on ${instrument}`}
    >
      {/* ground shadow */}
      <S d={ellipsePath(120, 248, 66, 7)} ink="#b9ab8c" hatch="#b9ab8c" noStroke seed={sd} gap={2.6} angle={-20} hatchW={1.3} />
      <g ref={me.r("instBack")}>{parts.back}</g>
      <g ref={me.r("char")}>
        {art.back}
        {art.tail && <g ref={me.r("tail")}>{art.tail.node}</g>}
        <g ref={me.r("body")}>
          {!rig.hideFeet && (
            <>
              <g ref={me.r("footL")}>
                <S d={ellipsePath(ANCHOR.footL.x, ANCHOR.footL.y, 15, 8)} ink={ink} base={tint(feet, 0.25)} hatch={feet} seed={sd + 1} gap={3} />
              </g>
              <g ref={me.r("footR")}>
                <S d={ellipsePath(ANCHOR.footR.x, ANCHOR.footR.y, 15, 8)} ink={ink} base={tint(feet, 0.25)} hatch={feet} seed={sd + 2} gap={3} />
              </g>
            </>
          )}
          {art.body}
        </g>
        <g ref={me.r("head")}>
          {art.ears?.map((e, i) => (
            <g key={i} ref={me.r("ear" + i)}>
              {e.node}
            </g>
          ))}
          {art.head}
          <Blush at={art.face.blush[0]} seed={sd + 3} />
          <Blush at={art.face.blush[1]} seed={sd + 4} />
          {/* eyes */}
          {([0, 1] as const).map((i) => (
            <g key={i} ref={me.r(i === 0 ? "eyeL" : "eyeR")} transform={`translate(${art.face.eyes[i].x} ${art.face.eyes[i].y})`}>
              <ellipse cx={0} cy={0} rx={eyeR} ry={eyeR * 1.1} fill={PENCIL} />
              <circle cx={-eyeR * 0.32} cy={-eyeR * 0.38} r={eyeR * 0.34} fill="#fffdf4" />
            </g>
          ))}
          <g ref={me.r("shut")} style={{ opacity: 0 }}>
            {art.face.eyes.map((e, i) => (
              <g key={i}>
                <path
                  d={`M${e.x - eyeR * 1.2} ${e.y} Q${e.x} ${e.y + eyeR * 1.3} ${e.x + eyeR * 1.2} ${e.y}`}
                  stroke={PENCIL}
                  strokeWidth={2.2}
                  fill={tint(fill, 0.25)}
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
          {art.front}
          {mp && (
            <g ref={me.r("mouth")}>
              <L d={mp} ink={PENCIL} seed={sd + 5} w={1.8} />
            </g>
          )}
          <g ref={me.r("grin")} style={{ opacity: 0 }}>
            <path
              d={`M${art.face.mouth.x - 8} ${art.face.mouth.y - 1} Q${art.face.mouth.x} ${art.face.mouth.y + 1} ${art.face.mouth.x + 8} ${art.face.mouth.y - 1} Q${art.face.mouth.x + 7} ${art.face.mouth.y + 9} ${art.face.mouth.x} ${art.face.mouth.y + 10} Q${art.face.mouth.x - 7} ${art.face.mouth.y + 9} ${art.face.mouth.x - 8} ${art.face.mouth.y - 1} Z`}
              fill="#5a2b2b"
              stroke={PENCIL}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <path d={`M${art.face.mouth.x - 4} ${art.face.mouth.y + 7.5} Q${art.face.mouth.x} ${art.face.mouth.y + 4} ${art.face.mouth.x + 4} ${art.face.mouth.y + 7.5}`} fill="#e9858f" />
          </g>
          <g ref={me.r("oh")} style={{ opacity: 0 }}>
            <ellipse cx={art.face.mouth.x} cy={art.face.mouth.y + 2} rx={3.6} ry={4.4} fill="#5a2b2b" stroke={PENCIL} strokeWidth={1.4} />
            <ellipse cx={art.face.mouth.x} cy={art.face.mouth.y + 4} rx={2} ry={1.4} fill="#e9858f" />
          </g>
          <g ref={me.r("brows")} style={{ opacity: 0 }}>
            {(["L", "R"] as const).map((k) => (
              <g key={k} ref={me.r("brow" + k)}>
                <path d={`M${-eyeR0 * 0.9} 0 Q0 ${-eyeR0 * 0.45} ${eyeR0 * 0.9} 0`} stroke={PENCIL} strokeWidth={1.7} fill="none" strokeLinecap="round" />
              </g>
            ))}
          </g>
          <g ref={me.r("cheeks")} style={{ opacity: 0 }}>
            {(["L", "R"] as const).map((k) => (
              <g key={k} ref={me.r("cheek" + k)}>
                <circle r={9} fill={tint(fill, 0.3)} stroke={ink} strokeWidth={1.5} />
                <circle r={3.6} cx={k === "L" ? -2 : 2} cy={2} fill="#f08c9a" opacity={0.5} />
              </g>
            ))}
          </g>
        </g>
      </g>
      <g ref={me.r("instFront")}>{parts.front}</g>
      {/* arms over the instrument: tapered, crayon-outlined, lightly hatched */}
      {(["L", "R"] as const).map((k) => (
        <g key={k}>
          <path ref={me.r("armFill" + k)} fill={mix(fill, "#f6f0e1", 0.18)} stroke="none" />
          <path ref={me.r("armHatch" + k)} stroke={fill} strokeWidth={1.3} strokeOpacity={0.75} strokeLinecap="round" fill="none" />
          <path
            ref={me.r("arm" + k)}
            stroke={ink}
            strokeWidth={2.2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="22 1.2 9 0.9"
          />
        </g>
      ))}
      {parts.held}
      {(["L", "R"] as const).map((k, i) => (
        <g key={k} ref={me.r("paw" + k)} transform={`translate(${i ? 140 : 100} 205)`}>
          {art.paw ? (
            <>
              <S d={ellipsePath(0, 0, 7.6, 7)} ink={ink} base={art.paw} hatch={mix(art.paw, "#000000", 0.3)} seed={sd + 6 + i} gap={2.4} w={1.6} />
              <path d="M0 -6 v5" stroke={mix(art.paw, "#f6f0e1", 0.5)} strokeWidth={1.1} strokeLinecap="round" />
            </>
          ) : (
            <>
              <S d={ellipsePath(0, 0, 8, 7.2)} ink={ink} base={tint(fill, 0.25)} hatch={fill} seed={sd + 6 + i} gap={2.6} w={1.6} />
              <path d="M-3 -4 v3 M0 -5 v3 M3 -4 v3" stroke={ink} strokeWidth={1} strokeLinecap="round" opacity={0.7} />
            </>
          )}
        </g>
      ))}
      {SPARKS.map((_, i) => (
        <g key={i} ref={me.r("spark" + i)} style={{ opacity: 0 }}>
          <path d="M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z" fill="#f5c84c" stroke="#c98a1c" strokeWidth={1} />
        </g>
      ))}
      {name && (
        <text x={120} y={266} textAnchor="middle" fontFamily="var(--font-script), cursive" fontSize={22} fontWeight={700} fill={ink}>
          {name}
        </text>
      )}
    </svg>
  );
});
