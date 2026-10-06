import { describe, expect, it } from "vitest";
import { STYLES, swingAt } from "@/music/styles";
import { applyFeel, beatAt, beatToSeconds, feelSpan, hash01, jitter, pocketSec, removeFeel, secAt, secondsToBeats, spbAt } from "./feel";

describe("beatToSeconds", () => {
  it("converts at tempo", () => {
    expect(beatToSeconds(1, 60)).toBe(1);
    expect(beatToSeconds(4, 120)).toBe(2);
    expect(secondsToBeats(2, 120)).toBe(4);
  });
});

describe("applyFeel", () => {
  it("is identity when straight", () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1.5, 3.333]) expect(applyFeel(x, 0.5)).toBeCloseTo(x);
  });

  it("never moves downbeats", () => {
    for (const b of [0, 1, 2, 7, 15]) expect(applyFeel(b, 0.66)).toBeCloseTo(b);
  });

  it("moves the offbeat 8th to the swing ratio", () => {
    expect(applyFeel(0.5, 0.62)).toBeCloseTo(0.62);
    expect(applyFeel(3.5, 0.66)).toBeCloseTo(3.66);
  });

  it("moves 16ths proportionally and keeps order", () => {
    const s = 0.62;
    const a = applyFeel(0.25, s);
    const b = applyFeel(0.5, s);
    const c = applyFeel(0.75, s);
    expect(a).toBeCloseTo(0.31);
    expect(c).toBeCloseTo(0.62 + 0.19);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(1);
  });

  it("leaves triplets alone", () => {
    expect(applyFeel(1 / 3, 0.66)).toBeCloseTo(1 / 3);
    expect(applyFeel(2 + 2 / 3, 0.66)).toBeCloseTo(2 + 2 / 3);
    expect(applyFeel(1 / 6, 0.66)).toBeCloseTo(1 / 6);
  });

  it("clamps silly swing values", () => {
    expect(applyFeel(0.5, 2)).toBeCloseTo(0.75);
    expect(applyFeel(0.5, 0.1)).toBeCloseTo(0.5);
    expect(applyFeel(0.5, Number.NaN)).toBeCloseTo(0.5);
  });

  it("is monotonic across a bar", () => {
    let prev = -1;
    for (let i = 0; i <= 64; i++) {
      const x = applyFeel(i / 16, 0.68);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it("round-trips with removeFeel", () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9, 2.5]) {
      expect(removeFeel(applyFeel(x, 0.64), 0.64)).toBeCloseTo(x);
    }
  });
});

describe("feelSpan", () => {
  it("long-short pair of swung 8ths", () => {
    const first = feelSpan(0, 0.5, 0.66);
    const second = feelSpan(0.5, 0.5, 0.66);
    expect(first.end - first.start).toBeCloseTo(0.66);
    expect(second.end - second.start).toBeCloseTo(0.34);
    expect(first.end).toBeCloseTo(second.start);
  });
});

describe("hash01 / jitter", () => {
  it("is deterministic and bounded", () => {
    const a = hash01("fox", 12, 60);
    expect(a).toBe(hash01("fox", 12, 60));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(hash01("fox", 12, 61)).not.toBe(a);
    for (let i = 0; i < 50; i++) {
      const j = jitter(0.008, "m", i);
      expect(Math.abs(j)).toBeLessThanOrEqual(0.008);
    }
  });
});

describe("swingAt", () => {
  it("swings harder slow and flattens fast; straight styles stay straight", () => {
    const sw = STYLES.swing;
    expect(swingAt(sw, 90)).toBeGreaterThan(swingAt(sw, 160));
    expect(swingAt(sw, 160)).toBeGreaterThan(swingAt(sw, 240));
    expect(swingAt(sw, 300)).toBeGreaterThanOrEqual(0.55);
    expect(swingAt(sw, 40)).toBeLessThanOrEqual(0.68);
    expect(swingAt(STYLES.funk, 100)).toBe(0.5);
  });
});

describe("pocketSec", () => {
  it("lays a swing soloist back, puts the bass on top, drags the funk backbeat", () => {
    expect(pocketSec("swing", "melodic", 70, undefined, true, 160)).toBeGreaterThan(pocketSec("swing", "melodic", 70, undefined, false, 160));
    expect(pocketSec("swing", "bass", 40, undefined, false, 160)).toBeLessThan(0);
    expect(pocketSec("swing", "rhythm", 51, undefined, false, 160)).toBe(0);
    expect(pocketSec("funk", "rhythm", 38, "accent", false, 100)).toBeGreaterThan(0);
    expect(pocketSec("funk", "rhythm", 38, "ghost", false, 100)).toBe(0);
    expect(pocketSec("baroque", "melodic", 70, undefined, true, 96)).toBe(0);
    // less room to lay back at a fast tempo
    expect(pocketSec("swing", "melodic", 70, undefined, true, 240)).toBeLessThan(pocketSec("swing", "melodic", 70, undefined, true, 120));
  });
});

describe("tempo map", () => {
  const m = { spb: 0.5, rit: { from: 56, to: 60, slow: 1.3 } };
  it("is in tempo before the ritardando and slows through it", () => {
    expect(secAt(m, 40)).toBeCloseTo(20);
    expect(secAt(m, -4)).toBeCloseTo(-2);
    expect(spbAt(m, 56)).toBeCloseTo(0.5);
    expect(spbAt(m, 58)).toBeCloseTo(0.575);
    expect(spbAt(m, 64)).toBeCloseTo(0.65);
    // four beats of rit take longer than four in tempo, but less than four at the slowest
    const span = secAt(m, 60) - secAt(m, 56);
    expect(span).toBeGreaterThan(2);
    expect(span).toBeLessThan(2.6);
  });
  it("maps time back to the beat", () => {
    for (const b of [-3, 0, 12.5, 55.9, 56, 57.3, 59.99, 60, 63.2]) expect(beatAt(m, secAt(m, b))).toBeCloseTo(b, 6);
    let prev = -Infinity;
    for (let b = 50; b < 66; b += 0.25) {
      const t = secAt(m, b);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
    expect(beatAt({ spb: 0.5 }, 3)).toBeCloseTo(6);
  });
});
