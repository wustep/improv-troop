import { describe, expect, it } from "vitest";
import { buildFrame, lengthOptions } from "./form";
import { DRUM, INSTRUMENTS, defaultMembers } from "./instruments";
import { defaultSettings, generateLocal } from "./local";
import { parseDrumGrid, parseNotes } from "./notation";
import { STANDARDS } from "./standards";
import { STYLES, STYLE_LIST } from "./styles";
import { homeOf } from "./ensemble";
import { holdable } from "./harmony";
import { harmonyOf, topLine } from "./realize";
import { chordPcs, mod, parseChord, parsePitch } from "./theory";
import type { Member, StyleId } from "./types";

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
    // judged against the chord each note is heard over, in context (key, where the chord is going)
    let bad = 0;
    for (const style of STYLE_LIST) {
      for (let seed = 1; seed <= 12; seed++) {
        const { score } = generateLocal({ ...defaultSettings(band), style, seed, soloists: ["sheep", "bear"] }, band);
        const H = harmonyOf(score.frame, score.plan);
        for (const id of ["fox", "sheep"]) {
          for (const n of score.parts[id]) {
            const bar = Math.floor(n.start / 4);
            const bp = score.plan[bar];
            if (!bp || !/^@line/.test(bp.directives?.[id] ?? "")) continue;
            const onBeat = Math.abs(n.start - Math.round(n.start)) < 1e-6;
            if (n.dur < 0.75 && !onBeat) continue;
            const h = homeOf(H, n);
            const pc = mod(n.pitch, 12);
            const ok = holdable(h, pc, style) || (n.dur < 0.75 && (h.scale.includes(pc) || h.blue.includes(pc)));
            if (!ok) bad++;
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
  it("keeps sustained pads and end chords on the chord they're heard over", () => {
    const band: Member[] = [...defaultMembers(), { id: "penguin", animal: "penguin", name: "Pip", instrument: "vibes" }];
    let bad = 0;
    for (const mode of ["major", "minor"] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const { score } = generateLocal({ ...defaultSettings(band), style: "ambient", key: { tonic: "D", mode }, seed }, band);
        const H = harmonyOf(score.frame, score.plan);
        for (const id of ["bear", "penguin"]) {
          for (const n of score.parts[id]) {
            // held: a pad, an end chord, a bell left ringing (a weak-beat bell can pass through a scale tone)
            if (n.dur < 1.5) continue;
            if (!holdable(homeOf(H, n), mod(n.pitch, 12), "ambient")) bad++;
          }
        }
      }
    }
    expect(bad).toBe(0);
  });
});

describe("rehearsing written notes", () => {
  it("bends held clashes onto the chord, keeps passing tones and blue notes", async () => {
    const { realize } = await import("./realize");
    const band = defaultMembers();
    const { score } = generateLocal({ ...defaultSettings(band), seed: 3, soloists: [] }, band);
    // a model-style head: bar 2 holds a major 7th over a dominant, a #9 blue note, and chromatic passing tones
    const bar = 1;
    const ch = parseChord("F7");
    const name = (pc: number, oct: number) => ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][pc] + oct;
    const maj7 = name(mod(ch.root + 11, 12), 5);
    const passing = name(mod(ch.root + 1, 12), 5);
    const plan = score.plan.map((bp) => ({ ...bp, directives: { ...bp.directives } }));
    plan[bar].chords = [{ beat: 0, symbol: "F7" }];
    const blue = name(mod(ch.root + 3, 12), 5);
    plan[bar].directives!.fox = `${passing}/8 ${name(ch.root, 5)}/8 ${blue}/4 ${maj7}/2`;
    const res = realize({ frame: score.frame, members: band, plan, motif: score.motif, seed: 3 });
    const notes = res.parts.fox.filter((n) => n.start >= bar * 4 && n.start < bar * 4 + 4);
    expect(mod(notes[0].pitch, 12)).toBe(mod(ch.root + 1, 12)); // chromatic passing tone kept
    expect(mod(notes[2].pitch, 12)).toBe(mod(ch.root + 3, 12)); // blue #9 kept
    expect(chordPcs(ch)).toContain(mod(notes[3].pitch, 12)); // held major 7th bent onto the chord
    expect(res.issues.filter((i) => i.detail.includes("clashed")).length).toBe(1);
  });
});

describe("playing like a band", () => {
  const band: Member[] = [
    ...defaultMembers(),
    { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" },
    { id: "sheep", animal: "sheep", name: "Olive", instrument: "cello" },
    { id: "penguin", animal: "penguin", name: "Pip", instrument: "vibes" },
  ];
  const takes = () =>
    STYLE_LIST.flatMap((style) =>
      [1, 2, 3].map((seed) => generateLocal({ ...defaultSettings(band), style, seed, soloists: ["cat", "bear", "penguin"] }, band).score),
    );
  const inBar = <T extends { start: number }>(notes: T[], bar: number, beats = 4): T[] => notes.filter((n) => Math.floor(n.start / beats + 1e-9) === bar);

  it("never holds a note over a chord it doesn't belong to, in any part", () => {
    let bad = 0;
    for (const score of takes()) {
      const H = harmonyOf(score.frame, score.plan);
      for (const m of band) {
        if (m.instrument === "drums") continue;
        for (const n of score.parts[m.id]) if (n.dur >= 1.5 && !holdable(homeOf(H, n), mod(n.pitch, 12), score.frame.style)) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it("comes back to the melody: the out head replays the head", () => {
    for (const score of takes()) {
      const replays = score.plan.filter((bp) => bp.directives?.fox?.startsWith("@head"));
      expect(replays.length).toBeGreaterThan(0);
      for (const bp of replays) {
        const src = parseInt(bp.directives!.fox!.split(" ")[1], 10) - 1;
        const here = inBar(score.parts.fox, bp.index).map((n) => n.start - bp.index * 4);
        const there = inBar(score.parts.fox, src).map((n) => n.start - src * 4);
        // same rhythm everywhere; same notes too unless the cadence bends a held note into a new chord
        expect(here).toEqual(there);
        if (bp.chords.length === score.plan[src].chords.length) {
          expect(inBar(score.parts.fox, bp.index).map((n) => n.pitch)).toEqual(inBar(score.parts.fox, src).map((n) => n.pitch));
        }
      }
    }
  });

  it("brings a standard's tune back in its repeated sections and out chorus", () => {
    const std = STANDARDS.find((s) => s.id === "rhythm-changes")!;
    const s = { ...defaultSettings(band), standard: std.id, key: std.key, style: std.style, bars: 32, soloists: ["cat"] };
    const { score } = generateLocal(s, band);
    const d = (b: number) => score.plan[b].directives?.fox;
    // A A B A: the second A replays the first wherever the changes match (bars 1-6)...
    for (let b = 8; b < 14; b++) expect(d(b)).toBe(`@head ${b - 7}`);
    // ...but its 7th bar has different changes (Cm7 F7, not Dm7 G7), so it's its own
    expect(d(14)).not.toMatch(/^@head/);
    // the out (last A) comes back to the tune, taking that 7th bar from the A it matches
    for (let b = 24; b < 30; b++) expect(d(b)).toBe(`@head ${b - 23}`);
    expect(d(30)).toBe("@head 15");
  });

  it("keeps comping under the melody and off its notes when there's room", () => {
    let bad = 0;
    for (const score of takes()) {
      for (let b = 0; b < score.frame.bars; b++) {
        const bp = score.plan[b];
        const lead = score.members.find((m) => ["lead", "solo"].includes(bp.roles[m.id] ?? "") && m.instrument !== "drums");
        if (!lead) continue;
        const tune = topLine(inBar(score.parts[lead.id], b)).filter((n) => n.dur >= 0.4 && n.pitch >= 55);
        for (const m of score.members) {
          if (m.id === lead.id || !INSTRUMENTS[m.instrument].poly || m.instrument === "drums" || !["comp", "pad"].includes(bp.roles[m.id] ?? "")) continue;
          for (const n of inBar(score.parts[m.id], b)) {
            for (const l of tune) {
              if (l.pitch - 1 < INSTRUMENTS[m.instrument].range[0] + 7) continue;
              if (Math.min(n.start + n.dur, l.start + l.dur) - Math.max(n.start, l.start) >= 0.3 && n.pitch >= l.pitch) bad++;
            }
          }
        }
      }
    }
    expect(bad).toBe(0);
  });

  it("phrases improvised lines on the style's grid, without leaping around inside a phrase", () => {
    for (const score of takes()) {
      const style = score.frame.style;
      for (let b = 0; b < score.frame.bars; b++) {
        const bp = score.plan[b];
        for (const id of ["cat", "fox"]) {
          if (!/^@line/.test(bp.directives?.[id] ?? "")) continue;
          const ns = inBar(score.parts[id], b);
          for (const n of ns) {
            const f = mod(n.start, 1);
            const grid = style === "funk" || style === "baroque" ? [0, 0.25, 0.5, 0.75] : [0, 0.5, 1 / 3, 2 / 3];
            expect(grid.some((g) => Math.abs(f - g) < 1e-3)).toBe(true);
          }
          for (let i = 1; i < ns.length; i++) {
            if (ns[i].start - (ns[i - 1].start + ns[i - 1].dur) < 0.3) expect(Math.abs(ns[i].pitch - ns[i - 1].pitch)).toBeLessThanOrEqual(12);
          }
        }
      }
    }
  });

  it("reads harmony in the key: a D minor baroque bass plays B natural over D minor only leading into a chord that has it", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { score } = generateLocal({ ...defaultSettings(band), style: "baroque", key: { tonic: "D", mode: "minor" }, seed }, band);
      const H = harmonyOf(score.frame, score.plan);
      for (const n of score.parts.frog) {
        const h = H.at(n.start);
        if (h.chord.symbol !== "Dm") continue;
        // (a secondary dominant after it, like G7, tonicizes C: then B natural is the raised 6th leading in)
        const next = H.spans.find((s) => s.start > h.start + 1e-6);
        if (!next || !chordPcs(next.chord).includes(11)) expect(mod(n.pitch, 12)).not.toBe(11);
      }
    }
  });

  it("interlocks minimalist ostinati instead of doubling them", () => {
    const { score } = generateLocal({ ...defaultSettings(band), style: "minimal", seed: 4, soloists: ["cat"] }, band);
    const bar = score.plan.findIndex((bp) => bp.directives?.bear === "@arp" && bp.directives?.penguin === "@arp");
    expect(bar).toBeGreaterThanOrEqual(0);
    const sig = (id: string) => inBar(score.parts[id], bar).map((n) => `${n.start - bar * 4}`).join();
    expect(sig("bear")).not.toBe(sig("penguin"));
  });
});

describe("endings", () => {
  const bandE: Member[] = [...defaultMembers(), { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" }];
  const take = (style: StyleId, mode: "major" | "minor" = "major") =>
    generateLocal({ ...defaultSettings(bandE), style, key: { tonic: "D", mode }, tempo: STYLES[style].tempo.default, seed: 2 }, bandE).score;
  it("funk stops dead on the one", () => {
    const s = take("funk");
    const last = (s.frame.bars - 1) * s.frame.meter.beats;
    for (const m of s.members) for (const n of s.parts[m.id].filter((x) => x.start >= last)) {
      expect(n.start).toBeCloseTo(last);
      expect(n.dur).toBeLessThanOrEqual(0.5);
    }
    expect(s.rit).toBeUndefined();
  });
  it("bossa stays intimate and slows into a soft ending", () => {
    const s = take("bossa");
    expect(s.plan.every((b) => ["pp", "p", "mp", "mf"].includes(b.dynamic))).toBe(true);
    expect(s.plan[s.plan.length - 1].dynamic).toBe("p");
    expect(s.rit && s.rit.slow).toBeGreaterThan(1);
    const drums = s.members.find((m) => m.instrument === "drums")!;
    expect(s.parts[drums.id].some((n) => n.pitch === DRUM.crash && n.start >= (s.frame.bars - 1) * 4)).toBe(false);
  });
  it("a baroque piece in minor ends on the major tonic", () => {
    const s = take("baroque", "minor");
    expect(s.frame.chords[s.frame.bars - 1][0].symbol).toBe("D");
  });
});

describe("reharmonization", () => {
  const changes = (seed: number, style: StyleId = "swing") => {
    const f = buildFrame({ ...defaultSettings(band), style, key: { ...STYLES[style].key }, seed, bars: 32 }, band);
    return { f, bars: f.chords.map((c) => c.map((x) => x.symbol).join(" ")) };
  };
  it("gives takes their own changes, opens up the solos, and brings the tune back", () => {
    const tunes = new Set([1, 2, 3, 4, 5, 6].map((s) => changes(s).bars.slice(0, 8).join("|")));
    expect(tunes.size).toBeGreaterThan(3);
    for (const seed of [1, 2, 3]) {
      const { f, bars } = changes(seed);
      const head = f.sections.find((s) => s.kind === "head")!;
      const out = f.sections.find((s) => s.kind === "out")!;
      expect(bars.slice(out.start, out.start + out.length - 2)).toEqual(bars.slice(0, out.length - 2));
      const solos = bars.slice(head.length, out.start - 1);
      expect(solos.some((b, i) => b !== bars[i % head.length])).toBe(true);
      expect(bars[bars.length - 1]).toBe("Bb6");
    }
  });
  it("leaves modal styles alone", () => {
    for (const seed of [1, 2, 3]) for (const b of changes(seed, "minimal").bars) expect(b).not.toMatch(/dim|9|13|b9/);
  });
});

describe("call and response", () => {
  it("a soloist taking over answers the last soloist's closing phrase", () => {
    const b: Member[] = [...defaultMembers(), { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" }];
    let found = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { score } = generateLocal({ ...defaultSettings(b), style: "swing", seed, bars: 32 }, b);
      const bar = score.plan.findIndex((bp) => Object.values(bp.directives ?? {}).includes("@answer"));
      if (bar < 0) continue;
      found++;
      const id = Object.keys(score.plan[bar].directives!).find((k) => score.plan[bar].directives![k] === "@answer")!;
      const notes = score.parts[id].filter((n) => Math.floor(n.start / 4 + 1e-9) === bar);
      expect(notes.length).toBeGreaterThanOrEqual(2);
      // on the grid
      for (const n of notes) expect(Math.abs(n.start * 4 - Math.round(n.start * 4))).toBeLessThan(1e-6);
    }
    expect(found).toBeGreaterThan(2);
  });
});

describe("arrangement textures", () => {
  const b: Member[] = [...defaultMembers(), { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" }];
  it("stop-time: the rhythm section hits the one together; breakdown: bass and drums only", () => {
    const sw = generateLocal({ ...defaultSettings(b), style: "swing", seed: 3, bars: 32 }, b).score;
    const st = sw.plan.findIndex((bp) => bp.texture === "stoptime");
    expect(st).toBeGreaterThan(0);
    for (const m of sw.members) {
      if (sw.plan[st].roles[m.id] === "solo") continue;
      for (const n of sw.parts[m.id].filter((x) => Math.floor(x.start / 4 + 1e-9) === st)) {
        if (n.pitch === DRUM.hatPedal) continue;
        expect(n.start).toBeCloseTo(st * 4);
      }
    }
    const fk = generateLocal({ ...defaultSettings(b), style: "funk", key: { tonic: "E", mode: "minor" }, tempo: 102, seed: 3, bars: 32 }, b).score;
    const bd = fk.plan.findIndex((bp) => bp.texture === "breakdown");
    expect(bd).toBeGreaterThan(0);
    const piano = fk.members.find((m) => m.instrument === "piano")!;
    expect(fk.parts[piano.id].some((n) => Math.floor(n.start / 4 + 1e-9) === bd)).toBe(false);
  });
});

describe("drum fills", () => {
  // the last beat of every bar the drummer plays, as a fingerprint of what's in it
  const lastBeats = (style: StyleId, seeds: number[]) =>
    seeds.flatMap((seed) => {
      const { score } = generateLocal({ ...defaultSettings(band), style, bars: 32, seed, soloists: ["cat"] }, band);
      const beats = score.frame.meter.beats;
      return score.plan.map((_, b) =>
        score.parts.owl.filter((n) => n.start >= b * beats + beats - 1 - 1e-6 && n.start < (b + 1) * beats - 1e-6).map((n) => ({ ...n, start: +(n.start - b * beats).toFixed(3) })),
      );
    });
  const has = (bars: ReturnType<typeof lastBeats>, pitch: number, start: number, art?: string) =>
    bars.some((ns) => ns.some((n) => n.pitch === pitch && Math.abs(n.start - start) < 0.01 && (!art || n.art === art)));
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);

  it("swing drummers say more than one thing at the end of a phrase", () => {
    const bars = lastBeats("swing", seeds);
    // the set-up: a kick on the last triplet partial, and the drag's snare there
    expect(has(bars, DRUM.kick, 3 + 2 / 3, "accent")).toBe(true);
    expect(bars.some((ns) => ns.filter((n) => n.pitch === DRUM.snare && n.art === "ghost").length >= 1 && has([ns], DRUM.floorTom, 3 + 2 / 3))).toBe(true);
    // and the old tom run is still in the vocabulary
    expect(has(bars, DRUM.midTom, 3 + 1 / 3)).toBe(true);
  });
  it("funk opens the hat or cracks the snare; New Orleans press-rolls", () => {
    expect(has(lastBeats("funk", seeds), DRUM.hatOpen, 3.5, "accent")).toBe(true);
    const no = lastBeats("neworleans", seeds);
    expect(no.some((ns) => ns.filter((n) => n.pitch === DRUM.snare && n.art === "ghost").length >= 3 && has([ns], DRUM.snare, 3.5, "accent"))).toBe(true);
  });
});

describe("swing in two", () => {
  it("plays the head in two and walks the solos", () => {
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { score } = generateLocal({ ...defaultSettings(band), style: "swing", bars: 32, seed, soloists: ["cat"] }, band);
      const { frame, parts } = score;
      const beats = frame.meter.beats;
      const onsets = (bar: number) => new Set(parts.frog.filter((n) => n.start >= bar * beats - 1e-6 && n.start < (bar + 1) * beats - 1e-6 && n.art !== "ghost").map((n) => Math.floor(n.start - bar * beats))).size;
      const mean = (bars: number[]) => bars.reduce((a, b) => a + onsets(b), 0) / bars.length;
      const head = frame.sections.find((s) => s.kind === "head" && s.length >= 8);
      const solo = frame.sections.find((s) => s.kind === "solo");
      if (!head || !solo) continue;
      const headBars = Array.from({ length: head.length - 1 }, (_, i) => head.start + i);
      const soloBars = Array.from({ length: solo.length - 1 }, (_, i) => solo.start + i);
      expect(mean(headBars)).toBeLessThanOrEqual(3);
      expect(mean(soloBars)).toBeGreaterThanOrEqual(3.5);
      // walking into the solos: the head's last bar is in four
      expect(score.plan[head.start + head.length - 1].directives?.frog).toBe("@walk");
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
