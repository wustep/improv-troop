"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { AnimalId, InstrumentId, MemberFrameState } from "@/music/types";
import { ANIMALS } from "@/music/instruments";
import { ANCHOR, Blush, animalArt, mouthPath } from "./animals";
import { L, PENCIL, S, ellipsePath, hash, mix, tint } from "./sketch";
import { type Mat, type Pt, I, ap, approach, attr, chain, clamp, rot, scl, tr } from "./affine";
import { RIGS } from "./rigs";
import { Bag, type Frame, type RigCtx } from "./rigs/types";

export interface SpriteHandle {
  update(state: MemberFrameState): void;
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

function armPath(s: Pt, h: Pt, side: -1 | 1, bend: number): string {
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
  const cx = (s.x + h.x) / 2 + px * amt;
  const cy = (s.y + h.y) / 2 + py * amt;
  return `M${s.x.toFixed(1)} ${s.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${h.x.toFixed(1)} ${h.y.toFixed(1)}`;
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
      seed: hash(animal + instrument),
      mouth: art.face.mouth,
      mem: {},
    }),
    [animal, instrument, def, art],
  );
  const parts = useMemo(() => rig.render(ctx), [rig, ctx]);
  const me = useMemo(() => new Bag(), []);

  const rt = useRef({
    last: 0,
    lastExternal: -1,
    state: IDLE_STATE as MemberFrameState,
    lean: 0,
    dip: 0,
    cheeks: 0,
    inhale: 0,
    bliss: 0,
    blinkAt: 1.5 + (hash(animal) % 1000) / 400,
    hands: { L: { x: 100, y: 205 }, R: { x: 140, y: 205 } } as Record<"L" | "R", Pt>,
  });

  const step = useMemo(() => {
    return (s: MemberFrameState) => {
      const r = rt.current;
      const t = performance.now() / 1000;
      const dt = r.last ? clamp(t - r.last, 0, 0.1) : 0.016;
      r.last = t;

      // ── body & head motion (uses last frame's lean/dip from the rig) ──
      const playing = s.playing;
      const energy = clamp(s.energy, 0, 1);
      const beatPulse = playing ? Math.pow(1 - clamp(s.beatPhase, 0, 1), 3) : 0;
      const bobAmp = playing ? (1.5 + 3.5 * energy) * (s.role === "rest" ? 0.55 : 1) : 0;
      const bob = playing ? bobAmp * beatPulse : Math.sin(t * 1.1) * 0.8;
      const tilt = playing ? Math.sin(s.beat * Math.PI) * (0.8 + 2 * energy) : Math.sin(t * 0.6) * 2;
      const feat = s.featured ? 1 : 0;
      const charM: Mat = chain(
        rot(r.lean * 0.9, 120, ANCHOR.ground),
        tr(0, r.dip),
        scl(1 + feat * 0.025, 1 + feat * 0.025, 120, ANCHOR.ground),
      );
      const headM: Mat = chain(charM, tr(0, bob), rot(tilt, ANCHOR.neck.x, ANCHOR.neck.y));
      const M = rig.follow === "world" ? I : rig.follow === "char" ? charM : headM;

      me.tf("char", attr(charM));
      me.tf("head", attr(chain(tr(0, bob), rot(tilt, ANCHOR.neck.x, ANCHOR.neck.y))));
      me.tf("instFront", attr(M));
      me.tf("instBack", attr(M));

      const f: Frame = {
        s,
        t,
        dt,
        M,
        arms: { L: { hand: r.hands.L, bend: 12 }, R: { hand: r.hands.R, bend: 12 } },
        look: { mouthCovered: false, cheeks: 0, inhale: 0, bliss: false, lean: 0, dip: 0 },
      };
      rig.update(ctx, f);

      // ── smooth look values ──
      const k = approach(dt, 0.12);
      r.lean += (clamp(f.look.lean, -8, 8) - r.lean) * k;
      r.dip += (clamp(f.look.dip, 0, 6) - r.dip) * approach(dt, 0.05);
      r.cheeks += (f.look.cheeks - r.cheeks) * approach(dt, 0.05);
      r.inhale += (f.look.inhale - r.inhale) * approach(dt, 0.1);
      r.bliss += ((f.look.bliss ? 1 : 0) - r.bliss) * approach(dt, 0.08);

      // ── breathing ──
      const breath = Math.sin(t * 1.8) * 0.012 + r.inhale * 0.03;
      me.tf("body", `translate(120 ${ANCHOR.ground}) scale(${(1 + r.inhale * 0.015).toFixed(4)} ${(1 + breath).toFixed(4)}) translate(-120 ${-ANCHOR.ground})`);

      // ── arms ──
      for (const side of ["L", "R"] as const) {
        const a = f.arms[side];
        r.hands[side] = a.hand;
        const sh = ap(charM, side === "L" ? ANCHOR.shoulderL.x : ANCHOR.shoulderR.x, ANCHOR.shoulderL.y);
        const d = armPath(sh, a.hand, side === "L" ? -1 : 1, a.bend ?? 12);
        me.set("arm" + side, "d", d);
        me.set("armIn" + side, "d", d);
        const spread = a.spread ?? 1;
        me.tf("paw" + side, `translate(${a.hand.x.toFixed(1)} ${a.hand.y.toFixed(1)}) rotate(${(a.pawRot ?? 0).toFixed(1)}) scale(${spread.toFixed(2)} 1)`);
        me.op("paw" + side, a.hidePaw ? 0 : 1);
      }

      // ── face ──
      const [e1, e2] = art.face.eyes;
      let blink = 1;
      if (t > r.blinkAt) {
        const p = (t - r.blinkAt) / 0.14;
        if (p >= 1) r.blinkAt = t + 2.2 + Math.random() * 3.2;
        else blink = Math.abs(1 - 2 * p);
      }
      const open = Math.max(0.08, blink) * (1 - r.bliss);
      // pupils glance toward the hands
      const hx = (r.hands.L.x + r.hands.R.x) / 2 - 120;
      const hy = (r.hands.L.y + r.hands.R.y) / 2 - 110;
      const gl = Math.hypot(hx, hy) || 1;
      const gx = (hx / gl) * 1.4;
      const gy = (hy / gl) * 1.4;
      me.tf("eyeL", `translate(${(e1.x + gx).toFixed(2)} ${(e1.y + gy).toFixed(2)}) scale(1 ${open.toFixed(3)})`);
      me.tf("eyeR", `translate(${(e2.x + gx).toFixed(2)} ${(e2.y + gy).toFixed(2)}) scale(1 ${open.toFixed(3)})`);
      me.op("shut", r.bliss);
      me.op("mouth", f.look.mouthCovered ? 0 : 1);
      const ch = r.cheeks;
      me.op("cheeks", ch > 0.02 ? 1 : 0);
      const cs = (0.35 + 0.65 * ch).toFixed(3);
      me.tf("cheekL", `translate(${art.face.mouth.x - 15} ${art.face.mouth.y - 1}) scale(${cs})`);
      me.tf("cheekR", `translate(${art.face.mouth.x + 15} ${art.face.mouth.y - 1}) scale(${cs})`);

      // ── feet: tap on the beat while listening / playing standing up ──
      if (!rig.seated) {
        const tap = playing ? Math.pow(1 - clamp(s.beatPhase, 0, 1), 4) * (s.role === "rest" ? 10 : 6) : 0;
        me.tf("footR", `rotate(${(-tap).toFixed(2)} ${ANCHOR.footR.x - 10} ${ANCHOR.footR.y + 4})`);
      }

      // ── soloist sparkles ──
      for (let i = 0; i < SPARKS.length; i++) {
        const tw = feat ? 0.45 + 0.55 * Math.sin(t * 4.2 + i * 2.1) : 0;
        me.op("spark" + i, Math.max(0, tw));
        me.tf("spark" + i, `translate(${SPARKS[i].x} ${SPARKS[i].y}) scale(${(0.7 + 0.4 * Math.max(0, tw)).toFixed(2)}) rotate(${((t * 40 + i * 60) % 360).toFixed(1)})`);
      }
    };
  }, [ctx, rig, me, art]);

  useImperativeHandle(
    ref,
    () => ({
      update(state: MemberFrameState) {
        rt.current.lastExternal = performance.now();
        rt.current.state = state;
        step(state);
      },
    }),
    [step],
  );

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
            : { ...r.state, playing: false, active: [], nextOnsetIn: Infinity, nextPitch: null, recent: r.state.recent.map((o) => ({ ...o, age: o.age + e })) },
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const { ink, fill } = def;
  const feet = art.feet ?? fill;
  const sd = hash(animal + "sprite");
  const mp = mouthPath(art.face.mouthStyle, art.face.mouth);
  const eyeR = art.face.eyeR;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={size}
      height={(size * VB_H) / VB_W}
      className={className}
      style={{ overflow: "visible" }}
      role="img"
      aria-label={`${name ?? def.name} the ${def.species} on ${instrument}`}
    >
      {/* ground shadow */}
      <S d={ellipsePath(120, 248, 66, 7)} ink="#b9ab8c" hatch="#b9ab8c" noStroke seed={sd} gap={2.6} angle={-20} hatchW={1.3} />
      <g ref={me.r("instBack")}>{parts.back}</g>
      <g ref={me.r("char")}>
        {art.back}
        <g ref={me.r("body")}>
          <g>
            <S d={ellipsePath(ANCHOR.footL.x, ANCHOR.footL.y, 15, 8)} ink={ink} base={tint(feet, 0.25)} hatch={feet} seed={sd + 1} gap={3} />
          </g>
          <g ref={me.r("footR")}>
            <S d={ellipsePath(ANCHOR.footR.x, ANCHOR.footR.y, 15, 8)} ink={ink} base={tint(feet, 0.25)} hatch={feet} seed={sd + 2} gap={3} />
          </g>
          {art.body}
        </g>
        <g ref={me.r("head")}>
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
      {/* arms over the instrument */}
      {(["L", "R"] as const).map((k) => (
        <g key={k}>
          <path ref={me.r("arm" + k)} stroke={ink} strokeWidth={13} fill="none" strokeLinecap="round" />
          <path ref={me.r("armIn" + k)} stroke={mix(fill, "#f6f0e1", 0.15)} strokeWidth={8.5} fill="none" strokeLinecap="round" />
        </g>
      ))}
      {parts.held}
      {(["L", "R"] as const).map((k, i) => (
        <g key={k} ref={me.r("paw" + k)} transform={`translate(${i ? 140 : 100} 205)`}>
          <S d={ellipsePath(0, 0, 8, 7.2)} ink={ink} base={tint(fill, 0.25)} hatch={fill} seed={sd + 6 + i} gap={2.6} w={1.6} />
          <path d="M-3 -4 v3 M0 -5 v3 M3 -4 v3" stroke={ink} strokeWidth={1} strokeLinecap="round" opacity={0.7} />
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
