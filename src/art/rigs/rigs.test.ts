import { describe, expect, it } from "vitest";
import { applyFeel, pocketOf } from "@/audio/feel";
import { DRUM, INSTRUMENT_LIST } from "@/music/instruments";
import { STYLES } from "@/music/styles";
import type { InstrumentId, StyleId } from "@/music/types";
import { glitchesOf } from "../glitch";
import { Motion } from "../motion";
import { RIGS } from ".";
import { rigTake } from "./take";
import { barX } from "./vibes";
import { Bag, type Frame, type RigCtx } from "./types";

// Drive a rig frame by frame (60 fps) through a real take, the way the stage does, and
// record what it draws. Then check each onset against what's on screen at that moment.

type Attrs = Record<string, Record<string, string>>;

function recordingBag() {
  const bag = new Bag();
  const store: Attrs = {};
  bag.el = new Proxy({} as Record<string, SVGElement | null>, {
    get: (_t, k: string) => {
      store[k] ??= {};
      return { setAttribute: (n: string, v: string) => (store[k][n] = v), style: {} } as unknown as SVGElement;
    },
  });
  return { bag, store };
}

const FPS = 60;

function perform(inst: InstrumentId, style: StyleId, seed = 3, solo = false, record = true, tempo?: number) {
  const { score, id, spb, beats, frames: fc } = rigTake(inst, style, { seed, solo, tempo });
  const pocket = pocketOf(score, id);
  // heard time: swing plus the player's pocket, as the audio engine schedules it
  const onsets = [...score.parts[id]].map((n) => ({ t: applyFeel(n.start, score.swing) * spb + pocket(n), pitch: n.pitch })).sort((a, b) => a.t - b.t);
  const { bag, store } = recordingBag();
  // the mouth sits at y 130–141 across the cast
  const ctx: RigCtx = { bag, animal: "cat", ink: "#000", fill: "#fff", light: "#fff", feet: "#000", seed: 1, mouth: { x: 120, y: 133 }, mem: {} };
  const end = beats * spb;
  const frames: Attrs[] = [];
  const glitches: { beat: number; kinds: string[] }[] = [];
  // the biggest change of a paw's velocity from one frame to the next (px/frame)
  let snap = { px: 0, beat: 0 };
  const vel = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } };
  // the body moves as on stage (lean, slide, bounce), and the arms start where its shoulders are
  const motion = new Motion({ follow: RIGS[inst].follow, seated: !!RIGS[inst].seated, ears: null, tail: null, seed: 7 });
  let hands: Frame["arms"] = { L: { hand: { x: 80, y: 190 } }, R: { hand: { x: 160, y: 190 } } };
  for (let i = 0; i * (1 / FPS) < end; i++) {
    const t = i / FPS + 0.004;
    const prev = { L: { ...hands.L.hand }, R: { ...hands.R.hand } };
    const s = fc.compute(id, t / spb, true, spb);
    const pose = motion.pose(s, t, 1 / FPS);
    const f: Frame = { s, t, dt: 1 / FPS, M: pose.M, arms: { L: { hand: { ...prev.L } }, R: { hand: { ...prev.R } } }, look: { mouthCovered: false, cheeks: 0, inhale: 0, bliss: false, lean: 0, dip: 0 } };
    RIGS[inst].update(ctx, f);
    motion.settle(f.look, 1 / FPS);
    // the first frames settle from the default pose
    const kinds = i > 5 ? glitchesOf({ L: f.arms.L.hand, R: f.arms.R.hand }, prev, pose.shoulders) : [];
    if (kinds.length) glitches.push({ beat: +(t / spb).toFixed(2), kinds });
    for (const k of ["L", "R"] as const) {
      const v = { x: f.arms[k].hand.x - prev[k].x, y: f.arms[k].hand.y - prev[k].y };
      const dv = Math.hypot(v.x - vel[k].x, v.y - vel[k].y);
      if (i > 10 && dv > snap.px) snap = { px: dv, beat: +(t / spb).toFixed(2) };
      vel[k] = v;
    }
    hands = { L: { ...f.arms.L }, R: { ...f.arms.R } };
    if (record) frames.push(JSON.parse(JSON.stringify(store)));
  }
  /** First frame drawn at or after time t. */
  const frameAt = (t: number) => frames[Math.max(0, Math.min(frames.length - 1, Math.ceil((t - 0.004) * FPS)))];
  return { onsets, frameAt, glitches, snap };
}

// where each drum is struck (see drums.tsx)
const STRIKE: Record<string, { x: number; y: number }> = {
  hat: { x: 54, y: 147 },
  crash: { x: 62, y: 100 },
  tom: { x: 104, y: 158 },
  ride: { x: 188, y: 135 },
  snare: { x: 150, y: 186 },
  floor: { x: 204, y: 206 },
};
function drumOf(p: number) {
  if (p === DRUM.floorTom || p === DRUM.lowTom) return "floor";
  if (p === DRUM.snare || p === DRUM.stick || p === DRUM.clap) return "snare";
  if (p === DRUM.hatClosed || p === DRUM.hatOpen) return "hat";
  if (p === DRUM.ride || p === DRUM.rideBell) return "ride";
  if (p === DRUM.crash) return "crash";
  return "tom";
}

describe("rigs follow the notes frame by frame", () => {
  it("a stick tip is on the drum at every stick hit", () => {
    for (const style of ["swing", "funk", "bossa", "neworleans"] as StyleId[]) {
      const { onsets, frameAt } = perform("drums", style);
      const hits = onsets.filter((o) => o.pitch !== DRUM.kick && o.pitch !== DRUM.hatPedal);
      const on = hits.filter((o) => {
        const fr = frameAt(o.t);
        const at = STRIKE[drumOf(o.pitch)];
        return ["L", "R"].some((a) => Math.hypot(+fr["tip" + a].cx - at.x, +fr["tip" + a].cy - at.y) < 12);
      });
      expect(on.length / hits.length, style).toBeGreaterThan(0.98);
    }
  });

  it("a vibes mallet is on the bar at every note, chords included", () => {
    for (const style of ["swing", "bossa", "minimal"] as StyleId[]) {
      const { onsets, frameAt } = perform("vibes", style);
      const on = onsets.filter((o) => {
        const fr = frameAt(o.t);
        return ["L0", "L1", "R1", "R0"].some((k) => Math.abs(+fr["m" + k].x2 - barX(o.pitch)) < 8);
      });
      expect(on.length / onsets.length, style).toBeGreaterThan(0.98);
    }
  });

  it("no arms cross, reach too far or lie across the chest, and no paw teleports, for any instrument, soloing or comping", () => {
    // what the art lab's "next glitch" stops on; drums crossed reaching for a hat under a crash,
    // the bow jumped to the other end for a long note, the clarinet's lower hand reached across,
    // the bassist's hand stretched over its head for the nut
    const found: string[] = [];
    const runs: [StyleId, number | undefined][] = [
      ["swing", undefined],
      ["swing", STYLES.swing.tempo.max],
      ["funk", undefined],
      ["baroque", undefined],
      ["ambient", STYLES.ambient.tempo.min],
    ];
    for (const inst of INSTRUMENT_LIST)
      for (const [style, tempo] of runs)
        for (const solo of [false, true]) {
          const { glitches } = perform(inst, style, 3, solo, false, tempo);
          if (glitches.length) found.push(`${inst} ${style}${tempo ? ` ${tempo}` : ""}${solo ? " solo" : ""}: ${glitches.length} frames, ${glitches.slice(0, 3).map((g) => `${g.kinds.join("+")} @${g.beat}`).join(", ")}`);
        }
    expect(found).toEqual([]);
  }, 120_000);

  it("paws ease into and out of their moves rather than snapping to full speed", () => {
    // an exponential ease starts at full speed: a hand leapt 15–21 px in the first frame of a
    // shift. A stick or mallet really does reverse at the head, so drums and vibes get more room.
    const LIMIT: Partial<Record<InstrumentId, number>> = { drums: 24, vibes: 20 };
    const found: string[] = [];
    for (const inst of INSTRUMENT_LIST)
      for (const style of ["swing", "funk", "baroque", "ambient"] as StyleId[])
        for (const solo of [false, true]) {
          const { snap } = perform(inst, style, 3, solo, false);
          if (snap.px > (LIMIT[inst] ?? 14)) found.push(`${inst} ${style}${solo ? " solo" : ""}: ${snap.px.toFixed(1)} px/frame @${snap.beat}`);
        }
    expect(found).toEqual([]);
  }, 120_000);
});
