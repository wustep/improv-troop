import type { MemberFrameState } from "@/music/types";
import { type Mat, type Pt, I, ap, approach, chain, clamp, rot, scl, tr } from "./affine";
import { ANCHOR } from "./animals";
import type { Look } from "./rigs/types";

// How a player's body moves: the groove (a bounce on the pulse, a sway over the bar), the idle
// life between takes, the reactions (a bow, a nod, a cheer), and the follow-through of ears and
// tails. Pure and clock-driven, so the art lab can replay a frame exactly and the rig tests can
// put the shoulders where the stage draws them.

/** How long the reactions last (s): a soloist's bow, a listener's nod, the end-of-take cheer. */
export const BOW_S = 1.4;
export const NOD_S = 0.8;
export const CHEER_S = 2.4;

const GROUND = ANCHOR.ground;
/** Shoulder and neck heights above the ground: a squash of the body lowers them in proportion. */
const SHOULDER_H = GROUND - ANCHOR.shoulderL.y;
const NECK_H = GROUND - ANCHOR.neck.y;

export const easeInOut = (x: number) => {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

/** Ease out past the target and settle back (`s` sets the overshoot). */
export const easeOutBack = (x: number, s = 1.70158) => {
  const k = clamp(x, 0, 1) - 1;
  return 1 + k * k * ((s + 1) * k + s);
};

/**
 * The pulse a body moves to: every beat, or at a quick tempo every other beat (a whole bar in
 * three), the way people nod half-time to a fast swing rather than bobbing frantically.
 */
export function pulseUnit(bpm: number, beatsPerBar: number): number {
  if (bpm <= 150) return 1;
  return beatsPerBar % 2 === 0 ? 2 : beatsPerBar;
}

/**
 * A bounce on the pulse: 1 at the bottom, on the beat, 0 at the top, between beats. Shaped like a
 * ball's bounce: a quick turn at the bottom (the beat lands) and hang time at the top.
 */
export function bounce(beat: number, unit: number): number {
  const u = (((beat / unit) % 1) + 1) % 1;
  return 1 - Math.sin(Math.PI * u);
}

/**
 * A foot tap: down on the beat, lifting through the back half of it and coming down on the next
 * (0 = on the floor, 1 = highest).
 */
export function footLift(beat: number, unit: number): number {
  const u = (((beat / unit) % 1) + 1) % 1;
  const k = clamp((u - 0.4) / 0.6, 0, 1);
  return Math.sin(Math.PI * k) * (1 - 0.3 * k);
}

/** A damped spring for secondary motion (ears, tails): it lags, overshoots and settles. */
export class Spring {
  x = 0;
  v = 0;
  constructor(
    /** Natural frequency (rad/s). */
    public w: number,
    /** Damping ratio (1 = no overshoot). */
    public zeta: number,
  ) {}
  /** Advance by dt toward `target`, with an outside push `force` (units/s²). */
  step(target: number, dt: number, force = 0): number {
    const n = Math.ceil(dt * 120);
    const h = n ? dt / n : 0;
    for (let i = 0; i < n; i++) {
      const a = this.w * this.w * (target - this.x) - 2 * this.zeta * this.w * this.v + force;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

/** A cheap repeatable pseudo-random number in [0, 1) from a time, so replayed frames match. */
export const randAt = (t: number, salt = 0) => (((Math.sin(t * 12.9898 + salt * 78.233) * 43758.5453) % 1) + 1) % 1;

export type EarKind = "stiff" | "floppy" | "flap";
export type TailKind = "bushy" | "curl" | "puff";

export interface MotionSpec {
  /** What the instrument follows: fixed on stage, the body, or the head (mouthpieces). */
  follow: "world" | "char" | "head";
  /** Seated or planted behind the instrument: a smaller sway and no foot tap. */
  seated: boolean;
  ears: EarKind | null;
  tail: TailKind | null;
  /** Per-animal offset so the band doesn't move as one. */
  seed: number;
}

export interface Pose {
  /** The whole character: lean, sway, slide, hop, the featured player's little extra size. */
  charM: Mat;
  /** The body inside it: breathing and squash, about the feet. */
  bodyM: Mat;
  /** The head inside the character: bob, nod, bow, turn. */
  headM: Mat;
  /** What the instrument follows. */
  M: Mat;
  /** Where the arms start this frame. */
  shoulders: Record<"L" | "R", Pt>;
  /** How far the head is turned toward the soloist, −1…1 (slow: the eyes lead it). */
  headTurn: number;
  /** The eyes' own glance toward the soloist, −1…1 (quick). */
  eyeTurn: number;
  /** Each foot's lift, degrees: the tapping foot, and steps while walking along an instrument. */
  feet: [number, number];
  /** Ear angles (degrees, + = outward) and the flap of big ears (x scale). */
  ears: [number, number];
  earFlap: number;
  /** Tail swing, degrees. */
  tail: number;
  /** 0…1: eyes shut happily (bow, cheer). */
  happy: number;
  /** 0…1: grinning (the cheer, the end of a bow). */
  grin: number;
  /** 0…1: half-lidded, listening in a soft passage. */
  soft: number;
  /** 0…1: how much the player is in the groove (eases in and out of playing). */
  groove: number;
}

/** Per-sprite motion state. `pose` before the rig runs (it reads last frame's look), `settle` after. */
export class Motion {
  lean = 0;
  dip = 0;
  shift = 0;
  pedal = -1;
  cheeks = 0;
  inhale = 0;
  bliss = 0;
  groove = 0;
  feat = 0;
  soft = 0;
  glance = 0;
  eyeGlance = 0;
  bowT = -Infinity;
  nodT = -Infinity;
  cheerT = -Infinity;
  /** Set when a reaction or a turn of the head starts: the face blinks with it. */
  blinkCue = -Infinity;
  private wasFeatured = false;
  private lastLook = 0;
  private headY: number | null = null;
  private headV = 0;
  private bodyA: number | null = null;
  private bodyAV = 0;
  private twitchAt: number;
  private lastT = -Infinity;
  private lastShift = 0;
  private stepPhase = 0;
  private ear = [new Spring(22, 0.5), new Spring(22, 0.5)];
  private flap = new Spring(9, 0.4);
  private tailS: Spring;
  constructor(private spec: MotionSpec) {
    const floppy = spec.ears === "floppy";
    this.ear = [new Spring(floppy ? 11 : 24, floppy ? 0.32 : 0.5), new Spring(floppy ? 11 : 24, floppy ? 0.32 : 0.5)];
    this.tailS = spec.tail === "puff" ? new Spring(18, 0.35) : new Spring(7, 0.45);
    this.twitchAt = 2 + (spec.seed % 1000) / 250;
  }

  cheer(t: number) {
    this.cheerT = t;
    this.blinkCue = t;
  }

  pose(s: MemberFrameState, t: number, dt: number): Pose {
    const sp = this.spec;
    const ph = (sp.seed % 997) / 997;
    // the clock went back (the art lab seeking): forget what was in flight
    if (t < this.lastT - 0.25) {
      this.headY = this.bodyA = null;
      this.twitchAt = t + 1.5;
      if (this.bowT > t) this.bowT = -Infinity;
      if (this.nodT > t) this.nodT = -Infinity;
      if (this.cheerT > t) this.cheerT = -Infinity;
    }
    this.lastT = t;
    const playing = s.playing;
    const energy = clamp(s.energy, 0, 1);

    // into the groove quickly, out of it slowly (a last nod or two as the take stops)
    this.groove += ((playing ? 1 : 0) - this.groove) * approach(dt, playing ? 0.3 : 0.7);
    const g = this.groove;
    this.feat += ((s.featured ? 1 : 0) - this.feat) * approach(dt, 0.3);
    this.soft += ((playing && energy < 0.45 ? 1 : 0) - this.soft) * approach(dt, 0.4);

    // ── reactions to the shape of the take ──
    // A solo ends: the soloist takes a small bow. The spotlight moves on: the listeners nod it
    // along, each a beat apart so the band doesn't move as one.
    if (playing && this.wasFeatured && !s.featured) {
      this.bowT = t;
      this.blinkCue = t;
    }
    const look0 = s.lookX ?? 0;
    if (playing && !s.featured && look0 !== this.lastLook && Math.abs(look0 - this.lastLook) > 0.2 && t - this.bowT > BOW_S) this.nodT = t + (sp.seed % 5) * 0.06;
    this.wasFeatured = playing && s.featured;
    this.lastLook = look0;

    // the bow: a small rise, down from the waist, a held moment, and back up past level
    const bp = (t - this.bowT) / BOW_S;
    let bow = 0;
    if (bp >= 0 && bp < 1) {
      if (bp < 0.12) bow = -0.15 * Math.sin((Math.PI * bp) / 0.12);
      else if (bp < 0.45) bow = easeInOut((bp - 0.12) / 0.33);
      else if (bp < 0.62) bow = 1;
      else bow = 1 - easeOutBack((bp - 0.62) / 0.38, 2.2);
    }
    // the nod: two soft dips
    const np = (t - this.nodT) / NOD_S;
    const nod = np >= 0 && np < 1 ? Math.sin(2 * Math.PI * np) ** 2 : 0;
    // the cheer: crouch, a hop, land in a squash, a smaller hop, land, settle
    const cp = (t - this.cheerT) / CHEER_S;
    let hop = 0;
    let squash = 0;
    if (cp >= 0 && cp < 1) {
      const T = cp * CHEER_S;
      if (T < 0.16) squash = Math.sin((Math.PI / 2) * (T / 0.16)) * 0.07;
      else if (T < 0.56) {
        const k = (T - 0.16) / 0.4;
        hop = 4 * k * (1 - k) * 11;
        squash = -0.04 * Math.sin(Math.PI * k);
      } else if (T < 0.7) squash = Math.sin((Math.PI * (T - 0.56)) / 0.14) * 0.06;
      else if (T < 1.0) {
        const k = (T - 0.7) / 0.3;
        hop = 4 * k * (1 - k) * 6;
        squash = -0.025 * Math.sin(Math.PI * k);
      } else if (T < 1.12) squash = Math.sin((Math.PI * (T - 1.0)) / 0.12) * 0.035;
    }
    const cheering = cp >= 0 && cp < 1 ? 1 - cp : 0;

    // ── the groove: a bounce on the pulse from the knees, the head a touch behind ──
    const unit = pulseUnit(s.bpm || 120, s.beatsPerBar || 4);
    const listening = s.role === "rest";
    const amp = (1.2 + 2.8 * energy) * (listening ? 0.6 : 1) * (1 + 0.2 * this.feat) * (sp.seated ? 0.8 : 1);
    const lagBeats = (0.05 * (s.bpm || 120)) / 60;
    const bodyBob = g * amp * 0.35 * bounce(s.beat, unit);
    const headBob = g * amp * bounce(s.beat - lagBeats, unit);
    // weight from foot to foot over the bar (on 1 and 3 in four); seated players just rock
    const barLen = s.beatsPerBar || 4;
    const swayAmp = (sp.seated ? 0.7 : 1.4) * (0.6 + 0.6 * energy);
    const groovSway = g * swayAmp * Math.cos((2 * Math.PI * s.beat) / (barLen % 2 === 0 ? barLen : barLen * 2) + ph * 0.5);
    // idle: slow breaths, an occasional shift of weight, a look about
    const idle = 1 - g;
    const idleSway = idle * (Math.sin(t * 0.42 + ph * 6) * 1.1 + Math.sin(t * 0.97 + ph * 3) * 0.3) * (sp.seated ? 0.5 : 1);
    const idleBob = idle * Math.sin(t * 1.15 + ph * 4) * 0.7;
    const sway = groovSway + idleSway;

    // ── listening: glance toward whoever has the spotlight, more while resting ──
    const look = s.lookX ?? 0;
    const resting = listening || (s.active.length === 0 && s.nextOnsetIn > 1);
    const window = resting ? 0.62 : 0.28;
    const phase = (t * 0.21 + ph) % 1;
    // direction matters more than distance: even a neighbour gets a proper look
    const lookAmt = Math.sign(look) * (0.55 + 0.45 * Math.min(1, Math.abs(look)));
    let want = playing && !s.featured && look !== 0 && phase < window ? lookAmt : 0;
    if (!playing) {
      // between takes: now and then a look along the line
      const w = Math.sin(t * 0.29 + ph * 9);
      want = w > 0.8 ? 0.5 : w < -0.85 ? -0.45 : 0;
    }
    // the eyes go first, quickly; the head turns after them
    if (Math.abs(want - this.eyeGlance) > 0.3 && Math.abs(want) > Math.abs(this.eyeGlance)) this.blinkCue = t;
    this.eyeGlance += (want - this.eyeGlance) * approach(dt, 0.05);
    this.glance += (want - this.glance) * approach(dt, 0.32);
    // wind players keep the mouthpiece where it is: only their eyes wander
    const headTurn = this.glance * (sp.follow === "head" ? 0.25 : 1);

    // ── body: breathing, the bounce and the rig's dip squash it about the feet (they stay planted) ──
    const breath = Math.sin(t * (1.7 - 0.5 * g) + ph * 5) * (0.012 - 0.005 * g) + this.inhale * 0.03;
    const drop = this.dip + bodyBob + bow * 2.5 + nod * 0.6;
    const sy = 1 + breath - drop / SHOULDER_H - squash;
    const sx = 1 + this.inhale * 0.015 + squash * 0.6;
    const bodyM = chain(tr(120, GROUND), scl(sx, sy), tr(-120, -GROUND));
    const charM = chain(
      rot(this.lean * 0.9 + sway, 120, GROUND),
      tr(this.shift + sway * 0.5, -hop),
      scl(1 + this.feat * 0.025, 1 + this.feat * 0.025, 120, GROUND),
    );
    const neckDrop = NECK_H * (1 - sy);
    const tilt = g * Math.sin((Math.PI * s.beat) / unit) * (0.6 + 1.6 * energy) + idle * Math.sin(t * 0.6 + ph * 7) * 2 - sway * 0.45;
    const headDown = neckDrop + headBob + idleBob + bow * 5 + nod * 2.8;
    const headM = chain(tr(headTurn * 2.6, headDown), rot(tilt + headTurn * 4 + bow * 4, ANCHOR.neck.x, ANCHOR.neck.y));
    const charHead = chain(charM, headM);
    const M = sp.follow === "world" ? I : sp.follow === "char" ? charM : charHead;
    const shY = GROUND - SHOULDER_H * sy;
    const shoulders = {
      L: ap(charM, 120 + (ANCHOR.shoulderL.x - 120) * sx, shY),
      R: ap(charM, 120 + (ANCHOR.shoulderR.x - 120) * sx, shY),
    };

    // ── steps: walking along the instrument lifts the feet in turn (a slide alone would skate) ──
    const shiftV = dt > 0 ? (this.shift - this.lastShift) / dt : 0;
    this.lastShift = this.shift;
    const walking = clamp((Math.abs(shiftV) - 6) / 30, 0, 1);
    this.stepPhase += (Math.abs(shiftV) * dt) / 16;
    const stride = Math.sin(Math.PI * this.stepPhase);
    const stepL = walking * Math.max(0, stride) * 9;
    const stepR = walking * Math.max(0, -stride) * 9;
    const tap = sp.seated ? 0 : g * footLift(s.beat, unit) * (listening ? 10 : 6);

    // ── follow-through: ears and tail lag the head and body ──
    const hy = headDown - hop;
    let headA = 0;
    if (dt > 0) {
      if (this.headY !== null) {
        const v = (hy - this.headY) / dt;
        headA = clamp((v - this.headV) / dt, -4000, 4000);
        this.headV = v;
      }
      this.headY = hy;
    }
    const bodyAngle = this.lean * 0.9 + sway;
    let bodyAA = 0;
    if (dt > 0) {
      if (this.bodyA !== null) {
        const v = (bodyAngle - this.bodyA) / dt;
        bodyAA = clamp((v - this.bodyAV) / dt, -3000, 3000);
        this.bodyAV = v;
      }
      this.bodyA = bodyAngle;
    }
    // ears perk toward the soloist, droop a little in a soft passage, twitch now and then
    if (t > this.twitchAt) {
      const side = randAt(this.twitchAt, sp.seed) < 0.5 ? 0 : 1;
      if (sp.ears) this.ear[side].v += sp.ears === "floppy" ? -60 : -260;
      this.twitchAt = t + 2.5 + randAt(t, sp.seed + 1) * 5;
    }
    const perk = Math.abs(this.glance) > 0.3 || (s.featured && playing) ? -4 : 0;
    const earT = perk + this.soft * 5 + idle * 1.5 + cheering * -6 + bow * 6;
    const gain = sp.ears === "floppy" ? 0.09 : 0.025;
    const ears: [number, number] = [this.ear[0].step(earT, dt, headA * gain), this.ear[1].step(earT, dt, headA * gain * 0.9)];
    const earFlap = sp.ears === "flap" ? this.flap.step(g * 0.05 * bounce(s.beat - lagBeats * 2, unit) + cheering * 0.08, dt, -headA * 0.0004) : 0;
    // tail: swings with the sway a little behind it, wags in a cheer, swishes slowly at rest
    const wag = cheering * Math.sin(t * 15) * 14;
    const tailT = -sway * 4 + idle * Math.sin(t * 0.8 + ph * 2) * 5 + wag + g * Math.sin((Math.PI * s.beat) / unit) * 3;
    const tail = sp.tail ? this.tailS.step(tailT, dt, -bodyAA * 0.6 + headA * 0.02) : 0;

    return {
      charM,
      bodyM,
      headM,
      M,
      shoulders,
      headTurn,
      eyeTurn: this.eyeGlance,
      // a pedal foot rests on its bar: heel down, toe lifting off as the pedal comes up
      feet: [stepL, this.pedal >= 0 ? Math.max(stepR, (1 - this.pedal) * 6 * g) : Math.max(tap * (1 - walking), stepR)],
      ears,
      earFlap,
      tail,
      happy: Math.max(this.bliss, Math.min(1, Math.max(0, bow) * 1.6), Math.min(1, cheering * 2)),
      grin: Math.max(Math.min(1, cheering * 2.5), bp >= 0.55 && bp < 1 ? Math.sin(Math.PI * clamp((bp - 0.55) / 0.45, 0, 1)) : 0),
      soft: this.soft,
      groove: g,
    };
  }

  /** Ease toward what the rig asked for this frame. */
  settle(look: Look, dt: number) {
    const k = approach(dt, 0.12);
    this.lean += (clamp(look.lean, -8, 8) - this.lean) * k;
    this.shift += (clamp(look.shift ?? 0, -26, 26) - this.shift) * approach(dt, 0.18);
    if (look.pedal !== undefined) this.pedal = this.pedal < 0 ? look.pedal : this.pedal + (look.pedal - this.pedal) * approach(dt, 0.03);
    this.dip += (clamp(look.dip, 0, 6) - this.dip) * approach(dt, 0.05);
    this.cheeks += (look.cheeks - this.cheeks) * approach(dt, 0.05);
    this.inhale += (look.inhale - this.inhale) * approach(dt, 0.1);
    this.bliss += ((look.bliss ? 1 : 0) - this.bliss) * approach(dt, 0.08);
  }
}
