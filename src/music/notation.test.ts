import { describe, expect, it } from "vitest";
import { defaultMembers } from "./instruments";
import { defaultSettings, generateLocal } from "./local";
import { drumsToGrid, durationBeats, notesToText, parseDrumGrid, parseNotes, splitBars } from "./notation";
import { getStandard } from "./standards";
import { STYLES, STYLE_LIST } from "./styles";
import type { Member, NoteEvent, Score } from "./types";

// The text form is what models read (the band so far) and write (their bars). Whatever the
// engine plays has to survive a trip through it: same onsets, same pitches, no parse errors.

const band: Member[] = [
  ...defaultMembers(),
  { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" },
  { id: "sheep", animal: "sheep", name: "Olive", instrument: "cello" },
];

function takes(): Score[] {
  const out: Score[] = [];
  for (const style of STYLE_LIST) {
    for (const seed of [1, 2, 3]) out.push(generateLocal({ ...defaultSettings(band), style, seed, bars: 32, tempo: STYLES[style].tempo.default }, band).score);
  }
  const waltz = getStandard("greensleeves")!;
  for (const seed of [1, 2]) {
    out.push(generateLocal({ ...defaultSettings(band), style: waltz.style, standard: waltz.id, key: { ...waltz.key }, meter: { beats: waltz.meter }, bars: waltz.bars.length, seed }, band).score);
  }
  return out;
}

function barsOf(score: Score, id: string): NoteEvent[][] {
  const beats = score.frame.meter.beats;
  const bars: NoteEvent[][] = Array.from({ length: score.frame.bars }, () => []);
  for (const n of score.parts[id] ?? []) {
    const b = Math.floor((n.start + 1e-6) / beats);
    if (b >= 0 && b < bars.length) bars[b].push({ ...n, start: Math.max(0, n.start - b * beats) });
  }
  return bars;
}

/** Every onset the text can spell exactly: 32nds and triplets down to 32nd triplets. */
const onGrid = (start: number) => Math.abs(start * 24 - Math.round(start * 24)) < 1e-3;
const onsets = (ns: NoteEvent[]) => ns.map((n) => `${n.start.toFixed(3)}:${n.pitch}`).sort();
const scores = takes();

describe("notes ↔ text round trip", () => {
  for (const score of scores) {
    const beats = score.frame.meter.beats;
    it(`${score.title} (${beats}/4, seed ${score.settings.seed})`, () => {
      for (const m of band) {
        if (m.instrument === "drums") continue;
        barsOf(score, m.id).forEach((notes, b) => {
          const text = notesToText(notes, beats);
          const back = parseNotes(text, beats);
          const where = `${m.name} bar ${b + 1}: ${text}`;
          expect(back.errors, where).toEqual([]);
          if (notes.every((n) => onGrid(n.start))) {
            expect(back.covered, where).toBeCloseTo(beats, 3);
            expect(onsets(back.notes), where).toEqual(onsets(notes));
          } else {
            // rubato: off-grid onsets can only be approximated
            expect(back.notes.map((n) => n.pitch), where).toEqual([...notes].sort((a, c) => a.start - c.start || a.pitch - c.pitch).map((n) => n.pitch));
            back.notes.forEach((n, i) => expect(Math.abs(n.start - [...notes].sort((a, c) => a.start - c.start || a.pitch - c.pitch)[i].start), where).toBeLessThan(0.15));
          }
          // lengths are rounded to a note value, but never run into the next onset or past the bar
          for (const n of back.notes) expect(n.start + n.dur, where).toBeLessThanOrEqual(beats + 1e-6);
        });
      }
    });
  }
});

describe("drums ↔ grid round trip", () => {
  for (const score of scores) {
    const beats = score.frame.meter.beats;
    it(`${score.title} (${beats}/4, seed ${score.settings.seed})`, () => {
      barsOf(score, "owl").forEach((notes, b) => {
        const grid = drumsToGrid(notes, beats);
        const back = parseDrumGrid(grid, beats);
        const where = `bar ${b + 1}: ${grid}`;
        expect(back.errors, where).toEqual([]);
        // the grid is in 16ths: swung and triplet hits land on the nearest step
        expect(back.notes.length, where).toBeLessThanOrEqual(notes.length);
        for (const n of back.notes) expect(notes.some((o) => Math.abs(o.start - n.start) <= 0.125 + 1e-6), where).toBe(true);
        if (notes.length) expect(back.notes.length, where).toBeGreaterThan(0);
      });
    });
  }
});

describe("notation edges", () => {
  it("reads every note value it writes", () => {
    for (const [spec, beats] of [
      ["1", 4], ["2.", 3], ["2", 2], ["2t", 4 / 3], ["4.", 1.5], ["4", 1], ["8.", 0.75], ["4t", 2 / 3],
      ["8", 0.5], ["8t", 1 / 3], ["16", 0.25], ["16t", 1 / 6], ["32", 0.125], ["4..", 1.75],
    ] as [string, number][]) {
      expect(durationBeats(spec), spec).toBeCloseTo(beats, 6);
    }
    expect(durationBeats("3")).toBeNull();
    expect(durationBeats("4tt")).toBeNull();
  });

  it("keeps triplet onsets after a rest", () => {
    const notes: NoteEvent[] = [
      { pitch: 65, start: 1 / 3, dur: 2 / 3, vel: 0.8 },
      { pitch: 62, start: 1, dur: 0.5, vel: 0.8 },
    ];
    const text = notesToText(notes, 4);
    expect(onsets(parseNotes(text, 4).notes)).toEqual(onsets(notes));
  });

  it("an empty bar is a bar of rest", () => {
    expect(notesToText([], 4)).toBe("r/1");
    expect(notesToText([], 3)).toBe("r/2.");
  });

  it("splits bars on barlines", () => {
    expect(splitBars("C4/1 | D4/1 |E4/1")).toEqual(["C4/1", "D4/1", "E4/1"]);
  });
});
