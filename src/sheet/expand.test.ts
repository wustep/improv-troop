import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../music/types";
import { chordText, drumKeys, expandPart, keySpec, spell, spellingTable, TPB } from "./expand";

const n = (pitch: number, start: number, dur: number, vel = 0.8): NoteEvent => ({ pitch, start, dur, vel });

function sumTicks(tokens: { ticks: number }[]) {
  return tokens.reduce((a, t) => a + t.ticks, 0);
}

describe("expandPart", () => {
  it("fills empty parts with whole-bar rests", () => {
    const bars = expandPart([], { bars: 3, beatsPerBar: 4 });
    expect(bars).toHaveLength(3);
    for (const b of bars) {
      expect(b.tokens).toHaveLength(1);
      expect(b.tokens[0].fullBar).toBe(true);
    }
  });

  it("every bar sums to the meter", () => {
    const notes = [n(60, 0, 1.5), n(62, 1.5, 0.5), n(64, 2.25, 0.5), n(65, 3, 3.5), n(67, 7.5, 0.25)];
    for (const bpb of [3, 4]) {
      const bars = expandPart(notes, { bars: 4, beatsPerBar: bpb });
      for (const b of bars) expect(sumTicks(b.tokens)).toBe(bpb * TPB);
    }
  });

  it("ties notes across the bar line", () => {
    const bars = expandPart([n(60, 3, 2)], { bars: 2, beatsPerBar: 4 });
    const last = bars[0].tokens[bars[0].tokens.length - 1];
    const first = bars[1].tokens[0];
    expect(last.kind).toBe("note");
    expect(last.tieNext).toBe(true);
    expect(first.kind).toBe("note");
    expect(first.tiedFrom).toBe(true);
    expect(first.ticks).toBe(TPB);
  });

  it("does not hide beat 3 in 4/4", () => {
    // Half note starting on beat 2 → quarter tied to quarter.
    const [bar] = expandPart([n(60, 1, 2)], { bars: 1, beatsPerBar: 4 });
    const notes = bar.tokens.filter((t) => t.kind === "note");
    expect(notes.map((t) => t.dur)).toEqual(["q", "q"]);
    expect(notes[0].tieNext).toBe(true);
  });

  it("allows a half note on beat 2 of 3/4", () => {
    const [bar] = expandPart([n(60, 1, 2)], { bars: 1, beatsPerBar: 3 });
    const notes = bar.tokens.filter((t) => t.kind === "note");
    expect(notes.map((t) => t.dur)).toEqual(["h"]);
  });

  it("merges simultaneous onsets into chords, cut at the next onset", () => {
    const [bar] = expandPart([n(60, 0, 4), n(64, 0, 2), n(67, 0, 2), n(72, 2, 1)], { bars: 1, beatsPerBar: 4 });
    const first = bar.tokens[0];
    expect(first.pitches).toEqual([60, 64, 67]);
    expect(first.ticks).toBe(2 * TPB);
    expect(bar.tokens[1].pitches).toEqual([72]);
  });

  it("detects 8th-note triplets", () => {
    const notes = [n(60, 0, 1 / 3), n(62, 1 / 3, 1 / 3), n(64, 2 / 3, 1 / 3), n(65, 1, 1)];
    const [bar] = expandPart(notes, { bars: 1, beatsPerBar: 4 });
    const trip = bar.tokens.filter((t) => t.triplet);
    expect(trip).toHaveLength(3);
    expect(trip.every((t) => t.dur === "8" && t.beat === 0)).toBe(true);
    expect(sumTicks(bar.tokens)).toBe(4 * TPB);
  });

  it("quantises sloppy timing to the 16th grid", () => {
    const [bar] = expandPart([n(60, 0.02, 0.48), n(62, 0.51, 0.24), n(64, 0.76, 0.2)], { bars: 1, beatsPerBar: 4 });
    const notes = bar.tokens.filter((t) => t.kind === "note");
    expect(notes.map((t) => [t.start, t.dur])).toEqual([
      [0, "8"],
      [6, "16"],
      [9, "16"],
    ]);
  });

  it("applies notation shift and ignores out-of-range junk", () => {
    const [bar] = expandPart([n(40, 0, 1), n(NaN, 1, 1), n(50, 99, 1)], { bars: 1, beatsPerBar: 4, shift: 12 });
    expect(bar.tokens[0].pitches).toEqual([52]);
  });
});

describe("spelling", () => {
  it("uses flats in Bb major and sharps for the leading tone in minor", () => {
    const bb = spellingTable({ tonic: "Bb", mode: "major" });
    expect(spell(70, bb).key).toBe("bb/4");
    expect(spell(63, bb).key).toBe("eb/4");
    const gm = spellingTable({ tonic: "G", mode: "minor" });
    expect(spell(66, gm).key).toBe("f#/4");
    expect(spell(70, gm).key).toBe("bb/4");
  });

  it("handles Cb/B# octave edges", () => {
    const gb = spellingTable({ tonic: "Gb", mode: "major" });
    expect(spell(59, gb).key).toBe("cb/4");
  });

  it("produces VexFlow key specs", () => {
    expect(keySpec({ tonic: "Bb", mode: "major" })).toBe("Bb");
    expect(keySpec({ tonic: "G", mode: "minor" })).toBe("Gm");
    expect(keySpec({ tonic: "F#", mode: "major" })).toBe("F#");
  });
});

describe("drums and chords", () => {
  it("orders drum keys bottom to top", () => {
    expect(drumKeys([42, 36, 38])).toEqual(["f/4", "c/5", "g/5/x"]);
  });

  it("formats chord symbols like a jazz chart", () => {
    expect(chordText("Bbmaj7")).toEqual({ root: "B♭", main: "", sup: "Δ7", bass: "" });
    expect(chordText("Cm7")).toEqual({ root: "C", main: "m", sup: "7", bass: "" });
    expect(chordText("Am7b5")).toEqual({ root: "A", main: "", sup: "ø7", bass: "" });
    expect(chordText("F7b9")).toEqual({ root: "F", main: "", sup: "7♭9", bass: "" });
    expect(chordText("G7/B")).toEqual({ root: "G", main: "", sup: "7", bass: "B" });
  });
});

describe("quarter-note triplets", () => {
  it("groups three quarter triplets over two beats", () => {
    const notes = [n(60, 0, 2 / 3), n(62, 2 / 3, 2 / 3), n(64, 4 / 3, 2 / 3), n(65, 2, 2)];
    const [bar] = expandPart(notes, { bars: 1, beatsPerBar: 4 });
    const trip = bar.tokens.filter((t) => t.triplet);
    expect(trip.map((t) => [t.dur, t.beat])).toEqual([
      ["q", 0],
      ["q", 0],
      ["q", 0],
    ]);
    expect(trip.some((t) => t.tieNext)).toBe(false);
    expect(sumTicks(bar.tokens)).toBe(4 * TPB);
  });
});

describe("triplet detection", () => {
  it("does not let a long note's triplet-ish end swallow 16ths", () => {
    const notes = [n(60, 7 + 1 / 3, 4 / 3), n(62, 8, 0.25), n(64, 8.25, 0.25), n(65, 8.5, 0.5)];
    const bars = expandPart(notes, { bars: 3, beatsPerBar: 4 });
    const bar3 = bars[2].tokens.filter((t) => t.kind === "note");
    expect(bar3.slice(0, 3).map((t) => [t.start, t.dur, t.triplet])).toEqual([
      [0, "16", false],
      [3, "16", false],
      [6, "8", false],
    ]);
  });

  it("keeps a triplet quarter followed by a rest", () => {
    const [bar] = expandPart([n(60, 0, 2 / 3), n(62, 2, 1)], { bars: 1, beatsPerBar: 4 });
    expect(bar.tokens[0].triplet).toBe(true);
    expect(sumTicks(bar.tokens)).toBe(48);
  });
});
