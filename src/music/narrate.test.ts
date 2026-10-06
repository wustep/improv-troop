import { describe, expect, it } from "vitest";
import { defaultMembers } from "./instruments";
import { defaultSettings, generateLocal } from "./local";
import { STANDARDS } from "./standards";
import { STYLES, STYLE_LIST } from "./styles";
import type { Member, StyleId } from "./types";

const band: Member[] = [...defaultMembers(), { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" }];

function take(style: StyleId, seed: number, bars = 32, standard: string | null = null) {
  const s = { ...defaultSettings(band), style, bars, seed, standard, tempo: STYLES[style].tempo.default, key: { ...STYLES[style].key } };
  return generateLocal(s, band).score;
}

describe("local band talk", () => {
  for (const style of STYLE_LIST) {
    it(`${style}: lines come from band members, in bar order, inside the chart`, () => {
      for (const seed of [1, 7, 23]) {
        const score = take(style, seed);
        const ids = new Set(band.map((m) => m.id));
        expect(score.chat.length).toBeGreaterThan(1);
        expect(score.chat[0].phase).toBe("count-off");
        let lastBar = -1;
        for (const c of score.chat) {
          expect(ids.has(c.from)).toBe(true);
          expect(c.text.length).toBeGreaterThan(0);
          if (c.bar === undefined) continue;
          expect(c.bar).toBeGreaterThanOrEqual(lastBar);
          expect(c.bar).toBeLessThan(score.frame.bars);
          lastBar = c.bar;
        }
        expect(new Set(score.chat.map((c) => c.id)).size).toBe(score.chat.length);
      }
    });
  }

  it("every soloist announces their chorus", () => {
    const score = take("swing", 3);
    for (const s of score.frame.sections.filter((x) => x.kind === "solo")) {
      expect(score.chat.some((c) => c.bar === s.start && c.from === s.featured?.[0])).toBe(true);
    }
  });

  it("is the same for the same seed", () => {
    expect(take("bossa", 11).chat).toEqual(take("bossa", 11).chat);
    const std = STANDARDS[0];
    expect(take("swing", 5, std.bars.length, std.id).chat).toEqual(take("swing", 5, std.bars.length, std.id).chat);
  });
});

describe("band talk says what is actually played", () => {
  it("a soloist who answers the last one says so, and nobody describes a mid-solo fragment as their opener", () => {
    let answered = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const score = generateLocal({ ...defaultSettings(band), style: "swing", seed, bars: 32, soloists: ["cat", "bear"] }, band).score;
      for (const s of score.frame.sections.filter((x) => x.kind === "solo")) {
        const who = s.featured![0];
        const line = score.chat.find((c) => c.bar === s.start && c.from === who)!;
        const first = score.plan[s.start].directives?.[who] ?? "";
        if (first.startsWith("@answer")) {
          answered++;
          expect(line.text, `seed ${seed}`).toMatch(/left off|Answering|heard that/);
        }
        if (!first.startsWith("@motif frag")) expect(line.text).not.toMatch(/first few notes|chew on a piece/);
      }
    }
    expect(answered).toBeGreaterThan(0);
  });
  it("names the tune when the leader plays its written melody, after the intro", () => {
    const std = STANDARDS.find((s) => s.id === "saints")!;
    const score = generateLocal({ ...defaultSettings(band), standard: std.id, style: std.style, key: std.key, bars: 48, seed: 1 }, band).score;
    const head = score.frame.sections.find((s) => s.kind === "head")!;
    expect(head.start).toBe(4);
    expect(score.chat.some((c) => c.bar === head.start && c.text === "Here's When the Saints Go Marching In.")).toBe(true);
    expect(score.chat.some((c) => c.bar === 0 && c.from === "bear")).toBe(true);
  });
});
