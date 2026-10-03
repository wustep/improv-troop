import { describe, expect, it } from "vitest";
import { buildFrame, lengthOptions } from "./form";
import { DRUM, INSTRUMENTS, defaultMembers } from "./instruments";
import { defaultSettings, generateLocal } from "./local";
import { parseDrumGrid, parseNotes } from "./notation";
import { STANDARDS } from "./standards";
import { STYLE_LIST } from "./styles";
import { parseChord, parsePitch } from "./theory";
import type { Member } from "./types";

const band: Member[] = [
  ...defaultMembers(),
  { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" },
  { id: "bunny", animal: "bunny", name: "Clover", instrument: "violin" },
];

describe("notation", () => {
  it("parses notes, chords, ties, triplets", () => {
    const r = parseNotes("C4/8 D4/8 [C4 E4 G4]/4 G4/4~ G4/8 r/8", 4);
    expect(r.errors).toEqual([]);
    expect(r.notes.map((n) => n.pitch)).toEqual([60, 62, 60, 64, 67, 67]);
    const tied = r.notes[r.notes.length - 1];
    expect(tied.dur).toBeCloseTo(1.5);
    const t = parseNotes("C4/8t D4/8t E4/8t F4/4. r/4 G4/8", 4);
    expect(t.covered).toBeCloseTo(4);
  });
  it("flags overflow and bad tokens", () => {
    const r = parseNotes("C4/1 D4/4 X9/4", 4);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.notes.length).toBe(1);
  });
  it("parses drum grids", () => {
    const r = parseDrumGrid("rd:x...x.x.x...x.x. ph:....x.......x... sd:..g.......X.....", 4);
    expect(r.notes.filter((n) => n.pitch === DRUM.ride).length).toBe(6);
    expect(r.notes.find((n) => n.pitch === DRUM.snare && n.art === "accent")?.start).toBe(2.5);
  });
});

describe("theory", () => {
  it("parses chord symbols", () => {
    expect(parseChord("Cm7").quality).toBe("min7");
    expect(parseChord("F7b9").scale.length).toBe(8);
    expect(parseChord("Bbmaj7").root).toBe(10);
    expect(parseChord("Am7b5").quality).toBe("m7b5");
    expect(parseChord("G7/B").bass).toBe(11);
    expect(parsePitch("Bb3")).toBe(58);
  });
});

describe("frame", () => {
  it("locks length and covers every bar with a section", () => {
    for (const bars of [8, 12, 16, 24, 32]) {
      const s = { ...defaultSettings(band), bars };
      const f = buildFrame(s, band);
      expect(f.bars).toBe(bars);
      expect(f.chords.length).toBe(bars);
      const covered = new Set<number>();
      for (const sec of f.sections) for (let b = sec.start; b < sec.start + sec.length; b++) covered.add(b);
      expect(covered.size).toBe(bars);
    }
  });
  it("snaps standards to whole choruses", () => {
    expect(lengthOptions("f-blues")).toEqual([12, 24, 36, 48]);
  });
});

describe("local engine", () => {
  for (const style of STYLE_LIST) {
    it(`renders ${style} cleanly`, () => {
      const s = { ...defaultSettings(band), style, seed: 7, soloists: ["cat", "bunny", "owl"] };
      const { score, issues } = generateLocal(s, band);
      expect(score.plan.length).toBe(16);
      const totalBeats = 16 * score.frame.meter.beats;
      for (const m of band) {
        const notes = score.parts[m.id];
        for (const n of notes) {
          expect(Number.isFinite(n.pitch)).toBe(true);
          expect(n.start).toBeGreaterThanOrEqual(0);
          expect(n.start).toBeLessThan(totalBeats);
          expect(n.dur).toBeGreaterThan(0);
          if (m.instrument !== "drums") {
            expect(n.pitch).toBeGreaterThanOrEqual(INSTRUMENTS[m.instrument].range[0]);
            expect(n.pitch).toBeLessThanOrEqual(INSTRUMENTS[m.instrument].range[1]);
          }
        }
      }
      // the leader actually plays and the bass/drums keep time
      expect(score.parts[score.frame.leaderId].length).toBeGreaterThan(4);
      expect(score.parts.frog.length).toBeGreaterThan(10);
      if (style !== "baroque") expect(score.parts.owl.length).toBeGreaterThan(10);
      expect(issues.filter((i) => i.detail.startsWith("engine error"))).toEqual([]);
    });
  }

  it("renders every standard, including 3/4", () => {
    for (const std of STANDARDS) {
      const opts = lengthOptions(std.id);
      const bars = opts[Math.min(1, opts.length - 1)];
      const s = { ...defaultSettings(band), standard: std.id, key: std.key, style: std.style, bars, meter: { beats: std.meter } };
      const { score, issues } = generateLocal(s, band);
      expect(score.frame.bars).toBe(bars);
      expect(issues.filter((i) => i.detail.startsWith("engine error"))).toEqual([]);
      expect(Object.values(score.parts).some((p) => p.length > 0)).toBe(true);
    }
  });

  it("is deterministic per seed", () => {
    const s = { ...defaultSettings(band), seed: 42 };
    const a = generateLocal(s, band).score.parts;
    const b = generateLocal(s, band).score.parts;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
