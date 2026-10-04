import { describe, expect, it } from "vitest";
import { buildFrame, lengthOptions } from "./form";
import { DRUM, INSTRUMENTS, defaultMembers } from "./instruments";
import { defaultSettings, generateLocal } from "./local";
import { parseDrumGrid, parseNotes } from "./notation";
import { STANDARDS } from "./standards";
import { STYLE_LIST } from "./styles";
import { chordPcs, mod, parseChord, parsePitch, scalePcs } from "./theory";
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

describe("cello", () => {
  const olive: Member = { id: "sheep", animal: "sheep", name: "Olive", instrument: "cello" };
  const withBassist: Member[] = [...defaultMembers(), olive];
  const noBassist: Member[] = defaultMembers()
    .filter((m) => m.instrument !== "bass")
    .concat(olive);

  for (const style of STYLE_LIST) {
    it(`writes a tenor part, not a second bass line, in ${style}`, () => {
      const s = { ...defaultSettings(withBassist), style, seed: 11, soloists: ["sheep", "bear"] };
      const { score, issues } = generateLocal(s, withBassist);
      expect(issues.filter((i) => i.detail.startsWith("engine error"))).toEqual([]);
      const cello = score.parts.sheep;
      expect(cello.length).toBeGreaterThan(4);
      for (const n of cello) {
        expect(n.pitch).toBeGreaterThanOrEqual(36);
        expect(n.pitch).toBeLessThanOrEqual(81);
      }
      for (const bp of score.plan) expect(bp.roles.sheep).not.toBe("bass");
      // the cello solo climbs into the tenor register
      const solo = score.frame.sections.find((x) => x.kind === "solo" && x.featured?.[0] === "sheep");
      if (solo) {
        const notes = cello.filter((n) => n.start >= solo.start * 4 && n.start < (solo.start + solo.length) * 4);
        expect(Math.max(...notes.map((n) => n.pitch))).toBeGreaterThan(57);
      }
    });
  }

  it("plucks double-stops when comping in swing", () => {
    const s = { ...defaultSettings(withBassist), style: "swing" as const, seed: 3, soloists: ["bear"] };
    const { score } = generateLocal(s, withBassist);
    const pizz = score.parts.sheep.filter((n) => n.art === "pizz");
    expect(pizz.length).toBeGreaterThan(4);
    const onsets = new Map<number, number>();
    for (const n of pizz) onsets.set(n.start, (onsets.get(n.start) ?? 0) + 1);
    expect([...onsets.values()].some((c) => c === 2)).toBe(true);
  });

  it("takes the bass chair (pizzicato) only when there is no bassist", () => {
    const s = { ...defaultSettings(noBassist), style: "swing" as const, seed: 5, soloists: ["bear"] };
    const { score } = generateLocal(s, noBassist);
    const bassBars = score.plan.filter((bp) => bp.roles.sheep === "bass");
    expect(bassBars.length).toBeGreaterThan(8);
    const b = bassBars[1].index;
    const notes = score.parts.sheep.filter((n) => n.start >= b * 4 && n.start < b * 4 + 4);
    expect(notes.length).toBe(4); // walking quarters
    expect(notes.every((n) => n.art === "pizz" && n.pitch <= 52)).toBe(true);
  });
});

describe("melodic hygiene", () => {
  const band: Member[] = [...defaultMembers(), { id: "sheep", animal: "sheep", name: "Olive", instrument: "cello" }];
  it("restates the head motif in one register (no octave jumps between statements)", () => {
    for (const style of STYLE_LIST) {
      for (const seed of [1, 5, 9]) {
        const { score } = generateLocal({ ...defaultSettings(band), style, seed, soloists: ["sheep"] }, band);
        const head = score.frame.sections.find((s) => s.kind === "head")!;
        const centers: number[] = [];
        for (let b = head.start; b < head.start + head.length; b++) {
          if (!score.plan[b].directives?.fox?.startsWith("@motif")) continue;
          const ns = score.parts.fox.filter((n) => n.start >= b * 4 && n.start < b * 4 + 4);
          if (ns.length) centers.push(ns.reduce((s, n) => s + n.pitch, 0) / ns.length);
        }
        if (centers.length > 1) expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(10);
      }
    }
  });
  it("keeps held and strong-beat notes of improvised lines on the harmony", () => {
    let bad = 0;
    for (const style of STYLE_LIST) {
      for (let seed = 1; seed <= 12; seed++) {
        const { score } = generateLocal({ ...defaultSettings(band), style, seed, soloists: ["sheep", "bear"] }, band);
        for (const id of ["fox", "sheep"]) {
          for (const n of score.parts[id]) {
            const bar = Math.floor(n.start / 4);
            const bp = score.plan[bar];
            if (!bp || !/^@line/.test(bp.directives?.[id] ?? "")) continue;
            if (n.dur < 0.75 && Math.abs(n.start - Math.round(n.start)) > 1e-6) continue;
            let sym = bp.chords[0].symbol;
            for (const c of bp.chords) if (c.beat <= n.start - bar * 4 + 1e-6) sym = c.symbol;
            const ch = parseChord(sym);
            const ok = new Set([...chordPcs(ch), ...scalePcs(ch), ...ch.tensions.map((t) => mod(ch.root + t, 12))]);
            if (!ok.has(mod(n.pitch, 12))) bad++;
          }
        }
      }
    }
    expect(bad).toBe(0);
  });
});

describe("standards form", () => {
  it("always comes back to the melody, and defaults to a full head-solos-out performance", async () => {
    const { defaultStandardLength } = await import("./form");
    const band = defaultMembers();
    for (const std of STANDARDS) {
      expect(lengthOptions(std.id)).toContain(defaultStandardLength(std.id));
      for (const bars of lengthOptions(std.id)) {
        const s = { ...defaultSettings(band), standard: std.id, key: std.key, style: std.style, bars, meter: { beats: std.meter }, soloists: ["bear"] };
        const { score } = generateLocal(s, band);
        const last = score.frame.sections[score.frame.sections.length - 1];
        expect(["head", "out"]).toContain(last.kind);
        if (bars > std.bars.length || std.bars.length >= 16) expect(score.frame.sections.some((x) => x.kind === "solo")).toBe(true);
      }
    }
  });
});

describe("voicings", () => {
  it("keeps sustained pads and end chords on the chord (no b6/b9/b5 from blind 4ths)", () => {
    const band: Member[] = [...defaultMembers(), { id: "penguin", animal: "penguin", name: "Pip", instrument: "vibes" }];
    let bad = 0;
    for (const mode of ["major", "minor"] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const { score } = generateLocal({ ...defaultSettings(band), style: "ambient", key: { tonic: "D", mode }, seed }, band);
        for (const id of ["bear", "penguin"]) {
          for (const n of score.parts[id]) {
            if (n.dur < 1) continue;
            const bar = Math.floor(n.start / 4);
            const bp = score.plan[bar];
            let sym = bp.chords[0].symbol;
            for (const c of bp.chords) if (c.beat <= n.start - bar * 4 + 1e-6) sym = c.symbol;
            const ch = parseChord(sym);
            const ok = new Set([...chordPcs(ch), ...scalePcs(ch), ...ch.tensions.map((t) => mod(ch.root + t, 12))]);
            if (!ok.has(mod(n.pitch, 12))) bad++;
          }
        }
      }
    }
    expect(bad).toBe(0);
  });
});
