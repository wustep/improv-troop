import { describe, expect, it } from "vitest";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { cutShortTake } from "./takes";

describe("a jam saved mid-way", () => {
  const band = defaultMembers();
  const { score } = generateLocal({ ...defaultSettings(band), seed: 5 }, band);
  const beats = score.frame.meter.beats;
  const firstBars = Object.fromEntries(Object.entries(score.parts).map(([id, ns]) => [id, ns.filter((n) => n.start < 8 * beats)]));

  it("keeps what the band played and its talk, and plays the rest from the same plan", () => {
    const partial = { ...score, parts: firstBars, chat: [{ id: "x", from: "bear", text: "Taking it up.", phase: "jam" as const, bar: 4 }], notes: ["(still jamming…)"] };
    const take = cutShortTake(partial, 8, "Swing · jammed");
    expect(take.cutAt).toBe(8);
    expect(take.label).toBe("Swing · jammed (cut short)");
    expect(take.score.chat[0].text).toBe("Taking it up.");
    expect(take.score.notes.some((n) => n.includes("still jamming"))).toBe(false);
    for (const [id, ns] of Object.entries(take.score.parts)) {
      expect(ns.filter((n) => n.start < 8 * beats)).toEqual(firstBars[id]);
      if (score.parts[id].some((n) => n.start >= 8 * beats)) expect(ns.some((n) => n.start >= 8 * beats)).toBe(true);
    }
  });
});
