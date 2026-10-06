import { describe, expect, it } from "vitest";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { harmonyBlock } from "./prompts";

const band = defaultMembers();
const { frame, plan } = generateLocal({ ...defaultSettings(band), bars: 16, seed: 5 }, band).score;

describe("harmonyBlock", () => {
  it("lists the bars being written, then the chord the phrase is headed for", () => {
    const text = harmonyBlock(frame, plan, [4, 5, 6, 7]);
    expect(text).toMatch(/bar 5: .*\n.*bar 6: .*\n.*bar 7: .*\n.*bar 8: /);
    const next = frame.chords[8][0].symbol;
    expect(text).toContain(`then bar 9: ${next} (aim the phrase's last note at`);
  });
  it("has nothing to aim at past the last bar, or when the next bar is already listed", () => {
    expect(harmonyBlock(frame, plan, [14, 15])).not.toMatch(/then bar/);
    expect(harmonyBlock(frame, plan, [3, 4, 2])).toMatch(/then bar 6:/);
  });
});
