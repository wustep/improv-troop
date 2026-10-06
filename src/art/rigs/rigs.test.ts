import { describe, expect, it } from "vitest";
import { applyFeel, pocketOf } from "@/audio/feel";
import { FrameComputer } from "@/components/stage/frames";
import { DRUM, defaultMembers } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { STYLES } from "@/music/styles";
import type { InstrumentId, Member, StyleId } from "@/music/types";
import { I } from "../affine";
import { RIGS } from ".";
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

function perform(inst: InstrumentId, style: StyleId, seed = 3) {
  const band: Member[] = defaultMembers();
  if (!band.some((m) => m.instrument === inst)) band.push({ id: "guest", animal: "cat", name: "Guest", instrument: inst });
  const id = band.find((m) => m.instrument === inst)!.id;
  const st = STYLES[style];
  const { score } = generateLocal({ ...defaultSettings(band), style, tempo: st.tempo.default, key: { ...st.key }, seed }, band);
  const spb = 60 / score.frame.tempo;
  const pocket = pocketOf(score, id);
  // heard time: swing plus the player's pocket, as the audio engine schedules it
  const onsets = [...score.parts[id]].map((n) => ({ t: applyFeel(n.start, score.swing) * spb + pocket(n), pitch: n.pitch })).sort((a, b) => a.t - b.t);
  const fc = new FrameComputer(score);
  const { bag, store } = recordingBag();
  const ctx: RigCtx = { bag, animal: "cat", ink: "#000", fill: "#fff", light: "#fff", feet: "#000", seed: 1, mouth: { x: 120, y: 100 }, mem: {} };
  const end = score.frame.bars * score.frame.meter.beats * spb;
  const frames: Attrs[] = [];
  let hands: Frame["arms"] = { L: { hand: { x: 80, y: 190 } }, R: { hand: { x: 160, y: 190 } } };
  for (let i = 0; i * (1 / FPS) < end; i++) {
    const t = i / FPS + 0.004;
    const f: Frame = { s: fc.compute(id, t / spb, true, spb), t, dt: 1 / FPS, M: I, arms: hands, look: { mouthCovered: false, cheeks: 0, inhale: 0, bliss: false, lean: 0, dip: 0 } };
    RIGS[inst].update(ctx, f);
    hands = { L: { ...f.arms.L }, R: { ...f.arms.R } };
    frames.push(JSON.parse(JSON.stringify(store)));
  }
  /** First frame drawn at or after time t. */
  const frameAt = (t: number) => frames[Math.max(0, Math.min(frames.length - 1, Math.ceil((t - 0.004) * FPS)))];
  return { onsets, frameAt };
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
});
