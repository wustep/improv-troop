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
import { chordPcs, keyScale as keyScaleOf, mod, parseChord, parsePitch } from "./theory";
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
    expect(lengthOptions("f-blues")).toEqual([12, 24, 36, 48, 60, 72]);
    expect(lengthOptions("autumn")).toEqual([32, 64, 96, 128]);
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
      expect(score.frame.bars).toBe(bars + (score.frame.intro ?? 0));
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
    const b = bassBars.filter((bp) => bp.directives?.sheep === "@walk")[1].index;
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

describe("style feel in the rhythm section", () => {
  const cat: Member = { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" };
  const gtr: Member = { id: "penguin", animal: "penguin", name: "Pip", instrument: "guitar" };
  const take = (style: StyleId, seed: number, extra: Partial<ReturnType<typeof defaultSettings>> = {}) =>
    generateLocal({ ...defaultSettings([...defaultMembers(), cat, gtr]), style, seed, bars: 32, soloists: ["cat"], ...extra }, [...defaultMembers(), cat, gtr]).score;
  const barNotes = (notes: { start: number }[], bar: number, beats: number) => notes.filter((n) => Math.floor(n.start / beats + 1e-9) === bar);
  it("the bossa bass leans into each chord change on the and of 4", () => {
    let leaned = 0;
    let changes = 0;
    for (const seed of [1, 2, 3, 4]) {
      const s = take("bossa", seed);
      for (let b = 0; b < s.frame.bars - 2; b++) {
        if (!s.plan[b].directives?.frog?.startsWith("@bossa")) continue;
        const next = parseChord(s.frame.chords[b + 1][0].symbol);
        if (next.symbol === s.frame.chords[b].at(-1)!.symbol) continue;
        changes++;
        const pickup = barNotes(s.parts.frog, b, 4).find((n) => Math.abs((n as { start: number }).start - b * 4 - 3.5) < 0.01) as { pitch: number } | undefined;
        if (pickup && mod(pickup.pitch, 12) === next.bass) leaned++;
      }
    }
    expect(changes).toBeGreaterThan(20);
    expect(leaned / changes).toBeGreaterThan(0.8);
  });
  it("funk guitar locks one rhythm through a section, up high, around the bass", () => {
    for (const seed of [1, 2, 3]) {
      const s = take("funk", seed);
      for (const sec of s.frame.sections) {
        const rhythms = new Set<string>();
        for (let b = sec.start; b < sec.start + sec.length - 1; b++) {
          if ((b - sec.start + 1) % 4 === 0 || s.plan[b].directives?.penguin !== "@funk") continue;
          rhythms.add(barNotes(s.parts.penguin, b, 4).map((n) => +(n.start - b * 4).toFixed(2)).filter((x, i, a) => a.indexOf(x) === i).join(","));
        }
        if (rhythms.size) expect(rhythms.size, `seed ${seed} ${sec.name}`).toBeLessThanOrEqual(2);
      }
      const gtrNotes = s.parts.penguin.filter((n) => n.start < (s.frame.bars - 1) * 4);
      expect(Math.min(...gtrNotes.map((n) => n.pitch))).toBeGreaterThanOrEqual(55);
    }
  });
  it("a jazz waltz comps with more than one rhythm, and the bass takes every chord change", () => {
    const s = take("swing", 3, { meter: { beats: 3 } });
    const rhythms = new Set<string>();
    for (let b = 0; b < s.frame.bars - 1; b++) {
      rhythms.add(barNotes(s.parts.bear, b, 3).map((n) => +(n.start - b * 3).toFixed(2)).filter((x, i, a) => a.indexOf(x) === i).join(","));
      for (const c of s.frame.chords[b]) {
        if (c.beat === 0) continue;
        const hit = s.parts.frog.some((n) => Math.abs(n.start - (b * 3 + c.beat)) < 0.01 && mod(n.pitch, 12) === parseChord(c.symbol).bass);
        expect(hit, `bar ${b + 1}: ${c.symbol} on beat ${c.beat + 1}`).toBe(true);
      }
    }
    expect(rhythms.size).toBeGreaterThan(2);
  });
});

describe("two chord players", () => {
  it("complement each other instead of doubling, in every style", () => {
    for (const second of ["guitar", "vibes"] as const) {
      const pair: Member[] = [...defaultMembers(), { id: "penguin", animal: "penguin", name: "Pip", instrument: second }];
      for (const style of STYLE_LIST) {
        let notes = 0;
        let doubled = 0;
        for (const seed of [1, 2, 3]) {
          const { score } = generateLocal({ ...defaultSettings(pair), style, seed, bars: 16 }, pair);
          const last = (score.frame.bars - 1) * score.frame.meter.beats;
          const piano = new Set(score.parts.bear.map((n) => `${Math.round(n.start * 48)}:${n.pitch}`));
          for (const n of score.parts.penguin.filter((n) => n.start < last)) {
            notes++;
            if (piano.has(`${Math.round(n.start * 48)}:${n.pitch}`)) doubled++;
          }
        }
        if (notes) expect(doubled / notes, `${style} ${second}`).toBeLessThan(0.3);
      }
    }
  });
});

describe("comping voicings", () => {
  const band6: Member[] = [...defaultMembers(), { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" }, { id: "penguin", animal: "penguin", name: "Pip", instrument: "guitar" }];
  it("keep clear of mud low down and of the bassist's register, even under a low tune", () => {
    for (const style of STYLE_LIST) {
      let onsets = 0;
      let muddy = 0;
      let underBass = 0;
      for (const seed of [1, 2, 3])
        for (const tonic of ["E", "Bb"]) {
          const { score } = generateLocal({ ...defaultSettings(band6), style, seed, bars: 32, soloists: ["cat", "bear"], key: { tonic, mode: "major" } }, band6);
          const last = (score.frame.bars - 1) * score.frame.meter.beats;
          for (const id of ["bear", "penguin"]) {
            const by = new Map<number, number[]>();
            for (const n of score.parts[id]) if (n.start < last) by.set(Math.round(n.start * 48), [...(by.get(Math.round(n.start * 48)) ?? []), n.pitch]);
            for (const [k, ps] of by) {
              if (ps.length < 3) continue;
              onsets++;
              const v = [...ps].sort((a, b) => a - b);
              if (v.some((p, i) => i > 0 && p - v[i - 1] <= 2 && v[i - 1] < 52)) muddy++;
              const b = score.parts.frog.find((n) => n.start <= k / 48 + 1e-6 && n.start + n.dur > k / 48 + 1e-6);
              if (b && v[0] < b.pitch) underBass++;
            }
          }
        }
      expect(muddy / onsets, `${style} muddy`).toBeLessThan(0.02);
      if (style !== "neworleans") expect(underBass / onsets, `${style} under the bass`).toBeLessThan(0.05); // stride piano keeps its own left hand
    }
  });
});

describe("standards in choruses", () => {
  const cat: Member = { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" };
  const band5 = [...defaultMembers(), cat];
  const frameFor = (standard: string, bars: number, soloists: string[]) => {
    const std = STANDARDS.find((s) => s.id === standard)!;
    return buildFrame({ ...defaultSettings(band5), standard, key: std.key, style: std.style, bars, meter: { beats: std.meter }, soloists }, band5);
  };
  // counted from the top of the form (after the intro)
  const layout = (f: ReturnType<typeof buildFrame>) =>
    f.sections.filter((s) => s.kind !== "intro").map((s) => `${s.kind}:${s.start - (f.intro ?? 0)}+${s.length}${s.featured ? `:${s.featured.join(",")}` : ""}`);
  it("default length gives a chorus to each soloist between the head and the head out", async () => {
    const { defaultStandardLength } = await import("./form");
    expect(defaultStandardLength("autumn", 1)).toBe(96);
    expect(defaultStandardLength("autumn", 2)).toBe(128);
    expect(defaultStandardLength("f-blues", 2)).toBe(48);
    expect(defaultStandardLength("f-blues", 5)).toBe(60);
  });
  it("counts off into a rhythm-section intro: the tune's last bars, turned around into the head", () => {
    const f = frameFor("autumn", 96, ["cat"]);
    expect(f.intro).toBe(4);
    expect(f.sections[0]).toMatchObject({ kind: "intro", start: 0, length: 4 });
    expect(f.bars).toBe(100);
    // ...Gm6 | Gm6 G7 → Cm7: the last intro chord is the head's first chord's dominant
    expect(f.chords[3].at(-1)!.symbol).toBe("G7");
    expect(f.chords[4][0].symbol).toBe("Cm7");
    expect(Object.keys(f.slots[0])).toEqual([]);
    // a blues turnaround already leads home, so it stays as written
    const blues = frameFor("f-blues", 36, ["cat"]);
    expect(blues.chords.slice(0, 4).map((b) => b.map((c) => c.symbol).join(" "))).toEqual(["Gm7", "C7", "F7 D7", "Gm7 C7"]);
    // one time through, or a style that starts straight in, has no intro
    expect(frameFor("autumn", 32, ["cat"]).intro).toBe(0);
  });
  it("a free chart keeps its length (the intro comes out of the solos) and soloists get even turns", () => {
    for (const [bars, intro] of [[8, 0], [12, 0], [16, 2], [24, 4], [32, 4]] as const) {
      const f = buildFrame({ ...defaultSettings(band5), style: "swing", bars, soloists: ["cat", "bear"] }, band5);
      expect(f.bars, `${bars}`).toBe(bars);
      expect(f.intro ?? 0, `${bars}`).toBe(intro);
      const solos = f.sections.filter((s) => s.kind === "solo").map((s) => s.length);
      if (solos.length === 2) expect(Math.abs(solos[0] - solos[1]), `${bars}: ${solos}`).toBeLessThanOrEqual(0);
    }
    expect(buildFrame({ ...defaultSettings(band5), style: "ambient", bars: 32, soloists: ["cat"] }, band5).intro).toBe(0);
  });
  it("a swing standard played through three times ends with a tag: iii-VI-ii-V twice, then home", () => {
    const f = frameFor("f-blues", 36, ["cat"]);
    const tag = f.sections.at(-1)!;
    expect(tag).toMatchObject({ kind: "tag", length: 4 });
    const sym = (b: number) => f.chords[b].map((c) => c.symbol).join(" ");
    const end = f.bars - 1;
    expect([end - 4, end - 3, end - 2, end - 1, end].map(sym)).toEqual(["Am7 D7", "Gm7 C7", "Am7 D7", "Gm7 C7", "F6"]);
    expect(f.slots[tag.start].fox).toBe("lead");
    // twice through has no tag, and a minor tune keeps its plain ending
    expect(frameFor("f-blues", 24, ["cat"]).sections.at(-1)!.kind).not.toBe("tag");
    expect(frameFor("autumn", 96, ["cat"]).sections.at(-1)!.kind).not.toBe("tag");
  });
  it("a 32-bar tune: head, a whole chorus solo, head out", () => {
    expect(layout(frameFor("autumn", 96, ["cat"]))).toEqual(["head:0+32:fox", "solo:32+32:cat", "out:64+32:fox"]);
  });
  it("two soloists each take whole choruses of the blues", () => {
    expect(layout(frameFor("f-blues", 60, ["cat", "bear"]))).toEqual(["head:0+12:fox", "solo:12+24:cat", "solo:36+12:bear", "out:48+12:fox", "tag:60+4:fox"]);
  });
  it("more soloists than choruses split them where the form does", () => {
    expect(layout(frameFor("autumn", 96, ["cat", "bear"]))).toEqual(["head:0+32:fox", "solo:32+16:cat", "solo:48+16:bear", "out:64+32:fox"]);
  });
  it("the drummer trades 4s for a chorus, the horns taking turns", () => {
    const f = frameFor("f-blues", 72, ["cat", "bear", "owl"]);
    expect(layout(f)).toEqual(["head:0+12:fox", "solo:12+24:cat", "solo:36+12:bear", "trade:48+12:cat,bear,owl", "out:60+12:fox", "tag:72+4:fox"]);
    const trade = f.sections.find((s) => s.kind === "trade")!;
    expect(trade.turn).toBe(4);
    const who = (b: number) => Object.entries(f.slots[b]).filter(([, r]) => r === "solo" || r === "trade").map(([id]) => id).join();
    expect([48, 52, 56].map((b) => who(b + (f.intro ?? 0)))).toEqual(["cat", "owl", "bear"]);
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
        expect(["head", "out", "tag"]).toContain(last.kind);
        if (bars > std.bars.length || std.bars.length >= 16) expect(score.frame.sections.some((x) => x.kind === "solo")).toBe(true);
      }
    }
  });
  it("ends home on the tonic, with the form's turnaround as the cadence into it", () => {
    const band = defaultMembers();
    for (const std of STANDARDS) {
      for (const bars of lengthOptions(std.id)) {
        const s = { ...defaultSettings(band), standard: std.id, key: std.key, style: std.style, bars, meter: { beats: std.meter } };
        const { chords } = generateLocal(s, band).score.frame;
        const end = chords[chords.length - 1];
        expect(end.length, `${std.id} ${bars}`).toBe(1);
        expect(parseChord(end[0].symbol).root, `${std.id} ${bars} ends on ${end[0].symbol}`).toBe(mod(parsePitch(`${std.key.tonic}4`)!, 12));
      }
    }
    // a blues turns around and lands: ... | Gm7 C7 | F6
    const blues = STANDARDS.find((x) => x.id === "f-blues")!;
    const { chords } = generateLocal({ ...defaultSettings(band), standard: blues.id, key: blues.key, style: blues.style, bars: 12, meter: { beats: 4 } }, band).score.frame;
    expect(chords[10].map((c) => c.symbol).join(" ")).toBe("Gm7 C7");
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

describe("pop", () => {
  it("backbeat on 2 and 4, pumping root 8ths, block triads, a diatonic tune", () => {
    const cat: Member = { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" };
    const band5 = [...defaultMembers(), cat];
    const { score } = generateLocal({ ...defaultSettings(band5), style: "pop", seed: 4, bars: 16, soloists: ["cat"] }, band5);
    const inBar = <T extends { start: number }>(notes: T[], b: number) => notes.filter((n) => Math.floor(n.start / 4 + 1e-9) === b);
    const groove = score.plan.findIndex((bp) => bp.directives?.owl === "@groove");
    const snares = inBar(score.parts.owl, groove).filter((n) => n.pitch === DRUM.snare).map((n) => n.start - groove * 4);
    expect(snares).toEqual([1, 3]);
    const pumpBar = score.plan.findIndex((bp) => bp.directives?.frog === "@pump");
    expect(inBar(score.parts.frog, pumpBar).length).toBe(8);
    const chords = new Map<number, number[]>();
    for (const n of score.parts.bear.filter((n) => n.start < 15 * 4 && n.pitch >= 48)) chords.set(n.start, [...(chords.get(n.start) ?? []), n.pitch]);
    expect([...chords.values()].filter((v) => v.length === 3).length / chords.size).toBeGreaterThan(0.85);
    expect(score.frame.sections.map((s) => s.name)).toEqual(["Intro", "Chorus", "Break · Mochi", "Last chorus"]);
    // the tune stays in the key: hardly any chromatic notes
    const key = keyScaleOf(score.frame.key);
    const lead = score.parts[score.frame.leaderId];
    expect(lead.filter((n) => !key.includes(mod(n.pitch, 12))).length / lead.length).toBeLessThan(0.08);
  });
});

describe("standards with a written melody", () => {
  it("the leader plays the tune as written on the head and the head out, in any key", () => {
    for (const id of ["saints", "greensleeves", "ode-to-joy"]) {
      const std = STANDARDS.find((s) => s.id === id)!;
      for (const tonic of [std.key.tonic, "Eb"]) {
        const bars = std.bars.length * 3;
        const { score } = generateLocal({ ...defaultSettings(band), standard: id, key: { tonic, mode: std.key.mode }, style: std.style, bars, meter: { beats: std.meter }, soloists: ["bear"], seed: 2 }, band);
        const beats = score.frame.meter.beats;
        const lead = score.frame.leaderId;
        const semis = (((parsePitch(`${tonic}4`)! - parsePitch(`${std.key.tonic}4`)!) % 12) + 12) % 12;
        const sections = score.frame.sections.filter((s) => s.kind === "head" || s.kind === "out");
        expect(sections.length).toBe(2);
        let pitches: number[] = [];
        for (const sec of sections)
          for (let b = sec.start; b < sec.start + sec.length - (sec.kind === "out" ? 1 : 0); b++) {
            const want = parseNotes(std.melody![(b - (score.frame.intro ?? 0)) % std.bars.length], beats).notes;
            const got = score.parts[lead].filter((n) => Math.floor(n.start / beats + 1e-9) === b);
            expect(got.map((n) => +(n.start - b * beats).toFixed(3)), `${id} in ${tonic} bar ${b + 1} rhythm`).toEqual(want.map((n) => +n.start.toFixed(3)));
            expect(got.map((n) => mod(n.pitch, 12)), `${id} in ${tonic} bar ${b + 1}`).toEqual(want.map((n) => mod(n.pitch + semis, 12)));
            pitches = [...pitches, ...got.map((n) => n.pitch)];
          }
        // one register for the whole tune, inside the leader's range
        const inst = INSTRUMENTS[band.find((m) => m.id === lead)!.instrument];
        expect(Math.min(...pitches)).toBeGreaterThanOrEqual(inst.range[0]);
        expect(Math.max(...pitches)).toBeLessThanOrEqual(inst.range[1]);
      }
    }
  });
  it("each written melody bar fills its bar and sits on its chord's downbeat", () => {
    for (const std of STANDARDS.filter((s) => s.melody)) {
      expect(std.melody!.length, std.id).toBe(std.bars.length);
      std.melody!.forEach((bar, i) => {
        const r = parseNotes(bar, std.meter);
        expect(r.errors, `${std.id} bar ${i + 1}`).toEqual([]);
        expect(r.covered, `${std.id} bar ${i + 1}`).toBeCloseTo(std.meter);
        // a note struck on the downbeat belongs to the bar's first chord (the tune and its changes agree)
        const first = r.notes.find((n) => n.start < 1e-6);
        if (!first) return;
        const c = parseChord(std.bars[i].split(" ")[0]);
        const pcs = [...c.tones, ...c.tensions].map((t) => mod(c.root + t, 12));
        expect(pcs, `${std.id} bar ${i + 1}: ${bar} over ${std.bars[i]}`).toContain(mod(first.pitch, 12));
      });
    }
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
    const tunes = new Set([1, 2, 3, 4, 5, 6].map((s) => changes(s).bars.slice(changes(s).f.intro ?? 0).slice(0, 8).join("|")));
    expect(tunes.size).toBeGreaterThan(3);
    for (const seed of [1, 2, 3]) {
      const { f, bars } = changes(seed);
      const head = f.sections.find((s) => s.kind === "head")!;
      const out = f.sections.find((s) => s.kind === "out")!;
      expect(bars.slice(out.start, out.start + out.length - 2)).toEqual(bars.slice(head.start, head.start + out.length - 2));
      const solos = bars.slice(head.start + head.length, out.start - 1);
      expect(solos.some((b, i) => b !== bars[head.start + (i % head.length)])).toBe(true);
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
      // on the grid (16ths, or a swing line's triplets)
      for (const n of notes) expect(Math.min(Math.abs(n.start * 4 - Math.round(n.start * 4)), Math.abs(n.start * 3 - Math.round(n.start * 3)))).toBeLessThan(1e-6);
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

describe("the tune coming back", () => {
  it("replays a head bar only over the same changes, so a cadence bar that moved gets its own line", () => {
    let heads = 0;
    let moved = 0;
    for (const style of STYLE_LIST)
      for (const seed of [1, 2, 3, 4]) {
        const { score } = generateLocal({ ...defaultSettings(band), style, bars: 16, seed }, band);
        const chordsOf = (b: number) => score.frame.chords[b].map((c) => `${c.symbol}@${c.beat}`).join(" ");
        score.plan.forEach((bp, bar) => {
          const m = /^@head (\d+)/.exec(bp.directives?.[score.settings.leaderId] ?? "");
          if (!m) return;
          heads++;
          expect(chordsOf(+m[1] - 1), `${style} seed ${seed} bar ${bar + 1}`).toBe(chordsOf(bar));
        });
        // the free chart's cadence bar (V7 added) is out-head material over new changes
        const cadence = score.frame.bars - 2;
        if (score.frame.chords[cadence].length > 1 && !score.plan[cadence].directives?.[score.settings.leaderId]?.startsWith("@head")) moved++;
      }
    expect(heads).toBeGreaterThan(10);
    expect(moved).toBeGreaterThan(0);
  });
});

describe("accents", () => {
  it("are marked, not pre-boosted: the audio engine lifts each accent once", async () => {
    const { realize } = await import("./realize");
    const { score } = generateLocal({ ...defaultSettings(band), bars: 16, seed: 5 }, band);
    const leader = score.settings.leaderId;
    const bar = score.plan.findIndex((b) => b.directives?.[leader]?.startsWith("@motif"));
    const plan = score.plan.map((b) => ({ ...b, directives: { ...b.directives } }));
    plan[bar].directives![leader] = "C5/4> D5/4 E5/4 G5/4";
    const res = realize({ frame: score.frame, members: band, plan, motif: score.motif, seed: 5 });
    const notes = res.parts[leader].filter((n) => Math.floor(n.start / 4 + 1e-9) === bar);
    expect(notes[0].art).toBe("accent");
    expect(notes[0].vel).toBeCloseTo(notes[1].vel, 5);
  });
});

describe("@motif as a model writes it", () => {
  const play = async (directive: string, motifText: string) => {
    const { realize } = await import("./realize");
    const { motifFromText } = await import("./motif");
    const { score } = generateLocal({ ...defaultSettings(band), bars: 16, seed: 4 }, band);
    const leader = score.settings.leaderId;
    const bar = score.plan.findIndex((b) => b.directives?.[leader]?.startsWith("@motif"));
    const plan = score.plan.map((b) => ({ ...b, directives: { ...b.directives } }));
    plan[bar].directives![leader] = directive;
    const motif = motifFromText(motifText, 4, score.frame.chords[0][0].symbol);
    const res = realize({ frame: score.frame, members: band, plan, motif, seed: 4 });
    const notes = res.parts[leader].filter((n) => Math.floor(n.start / 4 + 1e-9) === bar).map((n) => [n.pitch, +(n.start % 4).toFixed(3)]);
    return { notes, issues: res.issues.filter((i) => i.bar === bar).map((i) => i.detail).join(" ") };
  };
  const twoBars = "C5/4 D5/4 E5/2 | G5/4 F5/4 E5/2";
  it("reads \"bar 2\" the way it reads \"bar2\"", async () => {
    const spaced = await play("@motif bar 2", twoBars);
    expect(spaced.notes).toEqual((await play("@motif bar2", twoBars)).notes);
    expect(spaced.notes).not.toEqual((await play("@motif", twoBars)).notes);
  });
  it("plays the statement's last bar when asked for a bar it doesn't have, and says so", async () => {
    const r = await play("@motif bar2", "C5/4 D5/4 E5/4 G5/4");
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.issues).toMatch(/no bar 2; playing bar 1/);
  });
  it("names the words it couldn't use", async () => {
    expect((await play("@motif up 2 octave", twoBars)).issues).toMatch(/ignored "octave"/);
  });
});

describe("the tune at the bar's dynamic", () => {
  it("a stated motif and a replayed head play softer at pp than at ff", async () => {
    const { realize } = await import("./realize");
    const { score } = generateLocal({ ...defaultSettings(band), bars: 32, seed: 2 }, band);
    const leader = score.settings.leaderId;
    const motifBar = score.plan.findIndex((b) => b.directives?.[leader]?.startsWith("@motif"));
    const headBar = score.plan.findIndex((b) => b.directives?.[leader]?.startsWith("@head"));
    expect(motifBar).toBeGreaterThanOrEqual(0);
    expect(headBar).toBeGreaterThan(motifBar);
    const at = (dyn: "pp" | "ff", bar: number) => {
      // the head stays where it was; only the bar being measured changes dynamic
      const plan = score.plan.map((b) => ({ ...b, dynamic: b.index === bar ? dyn : "mf" as const }));
      const notes = realize({ frame: score.frame, members: band, plan, motif: score.motif, seed: 2 }).parts[leader];
      const mine = notes.filter((n) => Math.floor(n.start / score.frame.meter.beats + 1e-9) === bar);
      expect(mine.length).toBeGreaterThan(0);
      return mine.reduce((s, n) => s + n.vel, 0) / mine.length;
    };
    expect(at("pp", motifBar)).toBeLessThan(at("ff", motifBar) * 0.75);
    expect(at("pp", headBar)).toBeLessThan(at("ff", headBar) * 0.75);
  });
});

describe("endings", () => {
  it("a style that slows down to end eases off through the ritardando instead of peaking", () => {
    for (const style of ["bossa", "baroque", "ambient"] as StyleId[])
      for (const seed of [1, 2, 3]) {
        const { score } = generateLocal({ ...defaultSettings(band), style, seed, bars: 16 }, band);
        const n = score.frame.bars;
        const rit = score.plan.slice(n - 3, n - 1);
        for (const bp of rit) expect(bp.texture, `${style} bar ${bp.index + 1}`).not.toBe("peak");
        const loud = (d: string) => ["pp", "p", "mp", "mf", "f", "ff"].indexOf(d);
        const dyn = score.plan.slice(n - 3).map((bp) => loud(bp.dynamic));
        for (let i = 1; i < dyn.length; i++) expect(dyn[i], `${style} seed ${seed}`).toBeLessThanOrEqual(dyn[i - 1]);
      }
  });
  it("swing still climbs into its big ending", () => {
    const { score } = generateLocal({ ...defaultSettings(band), style: "swing", seed: 1, bars: 16 }, band);
    expect(score.plan[score.frame.bars - 2].texture).toBe("peak");
  });
});

describe("chord symbols", () => {
  it("read sus2, altered fifths and the usual qualities as written", () => {
    const tones = (sym: string) => parseChord(sym).tones;
    expect(tones("Csus2")).toEqual([0, 2, 7]);
    expect(tones("Csus")).toEqual([0, 5, 7]);
    expect(tones("C7sus4")).toEqual([0, 5, 7, 10]);
    expect(tones("C7#5")).toEqual([0, 4, 8, 10]);
    expect(tones("C7+5")).toEqual([0, 4, 8, 10]);
    expect(tones("C7b5")).toEqual([0, 4, 6, 10]);
    expect(tones("Cm7b5")).toEqual([0, 3, 6, 10]);
    expect(tones("C7b9")).toEqual([0, 4, 7, 10]);
    expect(parseChord("C7#5").scale).toEqual([0, 2, 4, 6, 8, 10]);
    expect(parseChord("C7#5#9").scale).toContain(3);
  });
  it("a standard keeps its own mode in any key", () => {
    const std = STANDARDS.find((s) => s.id === "autumn")!;
    const f = buildFrame({ ...defaultSettings(band), standard: "autumn", key: { tonic: "E", mode: "major" }, style: std.style, bars: 32 }, band);
    expect(f.key).toEqual({ tonic: "E", mode: "minor" });
  });
});

describe("standards", () => {
  it("every chart fills its form, and every chord and head reads", () => {
    for (const std of STANDARDS) {
      expect(std.bars.length, std.id).toBe(std.form.reduce((n, [, len]) => n + len, 0));
      for (const bar of std.bars)
        for (const sym of bar.split(/\s+/)) {
          const c = parseChord(sym);
          expect(c.tones.length, `${std.id} ${sym}`).toBeGreaterThanOrEqual(3);
          expect(mod(c.root, 12), `${std.id} ${sym}`).toBe(mod(parsePitch(`${sym.match(/^[A-G][#b]?/)![0]}4`) ?? -1, 12));
        }
      if (std.motif) for (const bar of std.motif.split("|")) expect(parseNotes(bar, std.meter).covered, `${std.id} motif`).toBeCloseTo(std.meter);
    }
  });
  it("Autumn Leaves' chromatic ii–V lands on Ebmaj7, then the closing ii–V in one bar", () => {
    const autumn = STANDARDS.find((s) => s.id === "autumn")!;
    expect(autumn.bars.slice(26, 30)).toEqual(["Gm7 C7", "Fm7 Bb7", "Ebmaj7", "Am7b5 D7b9"]);
  });
});

describe("baroque prelude", () => {
  // the piano's notes in the bars it plays @prelude, below the tenor
  const lowPreludeNotes = (members: Member[]) =>
    [1, 2, 3, 4].flatMap((seed) => {
      const { score } = generateLocal({ ...defaultSettings(members), style: "baroque", seed }, members);
      const beats = score.frame.meter.beats;
      const bars = score.plan.filter((b) => b.directives?.bear === "@prelude").map((b) => b.index);
      return (score.parts.bear ?? []).filter((n) => bars.includes(Math.floor(n.start / beats + 1e-6)) && n.pitch < 50);
    });
  it("leaves the bass line to the bassist", () => {
    expect(band.some((m) => m.instrument === "bass")).toBe(true);
    expect(lowPreludeNotes(band)).toEqual([]);
  });
  it("holds the bass itself when nobody else does", () => {
    expect(lowPreludeNotes(band.filter((m) => m.instrument !== "bass")).length).toBeGreaterThan(0);
  });
});

describe("groove grids", () => {
  it("every built-in lane fills its bar in 16ths", async () => {
    const { GROOVES, FUNK_KICKS } = await import("./patterns/drums");
    const off: string[] = [];
    for (const [style, meters] of Object.entries(GROOVES))
      for (const [beats, grid] of Object.entries(meters))
        for (const [which, text] of Object.entries(grid))
          for (const lane of (text as string).split(/\s+/)) if (lane.split(":")[1].length !== +beats * 4) off.push(`${style} ${beats}/4 ${which} ${lane}`);
    for (const lane of FUNK_KICKS) if (lane.split(":")[1].length !== 16) off.push(`funk kick ${lane}`);
    expect(off).toEqual([]);
  });
});

describe("drum fills", () => {
  it("two hits on one drum at once keep the louder, so a fill's closing accent survives", async () => {
    const { finishPart } = await import("./realize");
    const owl = band.find((m) => m.instrument === "drums")!;
    const out = finishPart(owl, [
      { pitch: DRUM.snare, start: 3.75, dur: 0.1, vel: 0.6 },
      { pitch: DRUM.snare, start: 3.75, dur: 0.1, vel: 0.9, art: "accent" },
      { pitch: DRUM.kick, start: 3, dur: 0.1, vel: 0.7 },
      { pitch: DRUM.kick, start: 3, dur: 0.1, vel: 0.5 },
    ]);
    expect(out.filter((n) => n.pitch === DRUM.snare)).toMatchObject([{ vel: 0.9, art: "accent" }]);
    expect(out.filter((n) => n.pitch === DRUM.kick)).toMatchObject([{ vel: 0.7 }]);
  });

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

describe("ambient", () => {
  const takes = Array.from({ length: 10 }, (_, i) =>
    generateLocal({ ...defaultSettings(defaultMembers()), style: "ambient", bars: 32, seed: i + 1, soloists: ["fox"] }, defaultMembers()).score,
  );
  it("pads float over the barline when the harmony doesn't move", () => {
    let held = 0;
    let restruck = 0;
    for (const score of takes) {
      const beats = score.frame.meter.beats;
      for (let b = 1; b < score.plan.length - 1; b++) {
        if (score.plan[b].directives?.bear !== "@pad" || score.plan[b - 1].directives?.bear !== "@pad") continue;
        if (score.frame.chords[b - 1].at(-1)!.symbol !== score.frame.chords[b][0].symbol) continue;
        if (score.parts.bear.some((n) => Math.abs(n.start - b * beats) < 1e-6)) restruck++;
        else held++;
      }
    }
    expect(held).toBeGreaterThan(20);
    expect(held / (held + restruck)).toBeGreaterThan(0.9);
  });
  it("bells make a line of 4ths and 5ths", () => {
    let leaps = 0;
    let ivs = 0;
    for (const score of takes) {
      const beats = score.frame.meter.beats;
      const bells = score.parts.bear.filter((n) => n.art !== "legato" && score.plan[Math.floor(n.start / beats)].directives?.bear === "@shimmer").sort((a, b) => a.start - b.start);
      for (let i = 1; i < bells.length; i++) {
        const iv = Math.abs(bells[i].pitch - bells[i - 1].pitch);
        ivs++;
        if (iv === 5 || iv === 7) leaps++;
      }
    }
    expect(ivs).toBeGreaterThan(50);
    expect(leaps / ivs).toBeGreaterThan(0.4);
  });
});

describe("bass fifths", () => {
  it("are the chord's own fifth: a b5 over m7b5, never off a slash bass", () => {
    const band = defaultMembers();
    let checked = 0;
    for (const id of ["blue-bossa", "autumn", "rhythm-changes", "minor-blues", "giant-steps"]) {
      const std = STANDARDS.find((s) => s.id === id)!;
      for (let seed = 1; seed <= 6; seed++) {
        const bars = lengthOptions(std.id).at(-1)!;
        const { score } = generateLocal({ ...defaultSettings(band), standard: std.id, key: std.key, style: std.style, bars, seed, meter: { beats: std.meter }, soloists: ["fox"] }, band);
        const beats = score.frame.meter.beats;
        for (const n of score.parts.frog) {
          const b = Math.floor(n.start / beats + 1e-9);
          const pos = +(n.start - b * beats).toFixed(3);
          const d = score.plan[b]?.directives?.frog ?? "";
          // the fifth slots: beat 3 in two, the "and"s of 2 and 4 in bossa (pickups are approach notes)
          if (!(d.startsWith("@two") ? pos === 2 : d.startsWith("@bossa") && (pos === 1.5 || pos === 3.5))) continue;
          let sym = score.frame.chords[b][0].symbol;
          for (const c of score.frame.chords[b]) if (c.beat <= pos + 1e-6) sym = c.symbol;
          const c = parseChord(sym);
          const pcs = [...c.tones.map((t) => mod(c.root + t, 12)), c.bass];
          // the bossa's &4 leans into the next bar: the next chord's root is the anticipation
          if (d.startsWith("@bossa") && pos === 3.5 && score.frame.chords[b + 1]) pcs.push(parseChord(score.frame.chords[b + 1][0].symbol).bass);
          expect(pcs, `${id} seed ${seed} bar ${b + 1}: ${n.pitch} over ${sym}`).toContain(mod(n.pitch, 12));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
