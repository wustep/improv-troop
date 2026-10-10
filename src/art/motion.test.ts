import { describe, expect, it } from "vitest";
import type { MemberFrameState } from "@/music/types";
import { ap } from "./affine";
import { ANCHOR } from "./animals";
import { BOW_S, CHEER_S, Motion, Spring, bounce, footLift, pulseUnit, type MotionSpec } from "./motion";

const SPEC: MotionSpec = { follow: "char", seated: false, ears: "floppy", tail: "bushy", seed: 11 };
const LOOK = { mouthCovered: false, cheeks: 0, inhale: 0, bliss: false, lean: 0, dip: 0 };

function state(beat: number, playing = true, extra: Partial<MemberFrameState> = {}): MemberFrameState {
  return { playing, beat, beatPhase: ((beat % 1) + 1) % 1, bpm: 120, beatsPerBar: 4, active: [], recent: [], nextOnsetIn: Infinity, nextPitch: null, role: "comp", energy: 0.6, featured: false, ...extra };
}

/** Run a motion at 60 fps; `at(t)` says the state at each time. Returns each frame's head position. */
function run(m: Motion, from: number, to: number, at: (t: number) => MemberFrameState) {
  const out: { t: number; head: { x: number; y: number }; foot: { x: number; y: number }; shoulder: number }[] = [];
  for (let t = from; t < to; t += 1 / 60) {
    const p = m.pose(at(t), t, 1 / 60);
    m.settle(LOOK, 1 / 60);
    const char = (x: number, y: number) => ap(p.charM, x, y);
    const head = ap(p.headM, ANCHOR.mouth.x, ANCHOR.mouth.y);
    const foot = ap(p.bodyM, ANCHOR.footL.x, ANCHOR.footL.y + 8);
    out.push({ t, head: char(head.x, head.y), foot: char(foot.x, foot.y), shoulder: p.shoulders.L.y });
  }
  return out;
}

describe("the groove", () => {
  it("bounces down onto each beat and hangs between them, without a jump", () => {
    expect(bounce(4, 1)).toBeCloseTo(1);
    expect(bounce(4.5, 1)).toBeCloseTo(0);
    expect(Math.abs(bounce(4.999, 1) - bounce(5.001, 1))).toBeLessThan(0.01);
  });

  it("taps a foot down on the beat, lifting it through the back half", () => {
    expect(footLift(3, 1)).toBe(0);
    expect(footLift(3.2, 1)).toBe(0);
    expect(footLift(3.7, 1)).toBeGreaterThan(0.5);
    expect(footLift(3.999, 1)).toBeLessThan(0.02);
  });

  it("nods half-time when the tempo is quick (a whole bar in three)", () => {
    expect(pulseUnit(120, 4)).toBe(1);
    expect(pulseUnit(220, 4)).toBe(2);
    expect(pulseUnit(200, 3)).toBe(3);
  });

  it("eases into the groove and out of it: the head never jumps between frames", () => {
    const m = new Motion(SPEC);
    const spb = 0.5;
    const frames = run(m, 0, 6, (t) => (t < 2 || t > 4 ? state(t / spb, false) : state(t / spb)));
    let worst = 0;
    for (let i = 1; i < frames.length; i++) worst = Math.max(worst, Math.hypot(frames[i].head.x - frames[i - 1].head.x, frames[i].head.y - frames[i - 1].head.y));
    expect(worst).toBeLessThan(1.5);
    // and it does move to the music once in it
    const inGroove = frames.filter((f) => f.t > 3 && f.t < 4).map((f) => f.head.y);
    expect(Math.max(...inGroove) - Math.min(...inGroove)).toBeGreaterThan(2);
  });

  it("keeps the feet on the floor while the body bounces and dips", () => {
    const m = new Motion(SPEC);
    const frames = run(m, 0, 3, (t) => state(t / 0.5, true, { energy: 1 }));
    for (const f of frames) expect(Math.abs(f.foot.y - (ANCHOR.footL.y + 8))).toBeLessThan(1);
  });
});

describe("reactions", () => {
  it("a cheer crouches, leaves the ground twice, and comes back to rest", () => {
    const m = new Motion({ ...SPEC, seated: true });
    run(m, 0, 1, () => state(0, false));
    m.cheer(1);
    const frames = run(m, 1, 1 + CHEER_S + 0.5, () => state(0, false));
    const lowest = Math.min(...frames.map((f) => f.foot.y));
    expect(lowest).toBeLessThan(ANCHOR.footL.y + 8 - 8);
    // a crouch before the first hop: the shoulders drop
    expect(Math.max(...frames.filter((f) => f.t < 1.15).map((f) => f.shoulder))).toBeGreaterThan(ANCHOR.shoulderL.y + 3);
    const end = frames[frames.length - 1];
    expect(Math.abs(end.foot.y - (ANCHOR.footL.y + 8))).toBeLessThan(0.5);
  });

  it("a soloist's bow rises a little first, then goes down", () => {
    const m = new Motion(SPEC);
    const spb = 0.5;
    const frames = run(m, 0, 2 + BOW_S + 0.4, (t) => state(t / spb, true, { featured: t < 2 }));
    const rest = frames.find((f) => f.t > 1.9)!.head.y;
    const first = frames.filter((f) => f.t > 2.02 && f.t < 2 + BOW_S * 0.12);
    const deepest = Math.max(...frames.filter((f) => f.t > 2).map((f) => f.head.y));
    expect(Math.min(...first.map((f) => f.head.y))).toBeLessThan(rest + 4);
    expect(deepest).toBeGreaterThan(rest + 5);
  });
});

describe("Spring", () => {
  it("lags, overshoots, settles, and stands still for a paused frame", () => {
    const s = new Spring(11, 0.32);
    let peak = 0;
    for (let i = 0; i < 240; i++) peak = Math.max(peak, s.step(10, 1 / 60));
    expect(peak).toBeGreaterThan(10.5);
    expect(s.x).toBeCloseTo(10, 1);
    const x = s.x;
    s.step(30, 0);
    expect(s.x).toBe(x);
  });
});
