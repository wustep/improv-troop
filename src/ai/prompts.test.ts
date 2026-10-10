import { describe, expect, it } from "vitest";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { grooveCount, harmonyBlock } from "./prompts";
import { barsSchema } from "./schemas";

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

describe("chartBlock", () => {
  it("tells the band a song's head is its written melody (in this key), and where the intro is", async () => {
    const { chartBlock } = await import("./prompts");
    const { STANDARDS } = await import("@/music/standards");
    const std = STANDARDS.find((s) => s.id === "saints")!;
    const { score } = generateLocal({ ...defaultSettings(band), standard: "saints", style: std.style, key: { tonic: "Bb", mode: "major" }, bars: 48 }, band);
    const text = chartBlock(score.frame, band);
    expect(text).toContain("The tune is When the Saints Go Marching In");
    // bar 2 of the melody (r F A Bb in F) is r Bb D Eb in Bb
    expect(text).toMatch(/opens: .*\| r\/4 Bb\d\/4 D\d\/4 Eb\d\/4/);
    expect(text).toContain("Bars 1-4 are the intro");
  });
});

describe("counting a groove", () => {
  it("sums its examples to the bar's length", () => {
    expect(grooveCount(4)).toContain("1 + ½ + ½ + 1 + 1 = 4");
    expect(grooveCount(3)).toContain("1 + ½ + ½ + 1 = 3");
    expect(grooveCount(3)).toContain("The sum must be 3");
  });

  it("asks for each bar's count ahead of its notes", () => {
    const s = barsSchema([5, 6], true, true);
    expect(Object.keys(s.properties!)).toEqual(["count", "bars", "say"]);
    expect(s.required).toEqual(["count", "bars", "say"]);
    expect(Object.keys(barsSchema([5], false).properties!)).toEqual(["bars"]);
  });
});
