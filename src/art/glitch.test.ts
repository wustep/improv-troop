import { describe, expect, it } from "vitest";
import { ANCHOR } from "./animals";
import { REACH_PX, acrossBy, glitchesOf } from "./glitch";

const SH = { L: ANCHOR.shoulderL, R: ANCHOR.shoulderR };

describe("glitchesOf", () => {
  it("passes a comfortable pose", () => {
    expect(glitchesOf({ L: { x: 100, y: 205 }, R: { x: 140, y: 205 } }, { L: { x: 101, y: 204 }, R: { x: 141, y: 206 } })).toEqual([]);
  });

  it("flags arms that cross, and a paw that teleports", () => {
    expect(glitchesOf({ L: { x: 150, y: 215 }, R: { x: 90, y: 215 } }, null)).toContain("crossed");
    expect(glitchesOf({ L: { x: 100, y: 205 }, R: { x: 140, y: 205 } }, { L: { x: 100, y: 205 }, R: { x: 180, y: 205 } })).toEqual(["jump"]);
  });

  it("flags a paw out of the arm's reach, wherever it goes", () => {
    // the old bassist: a hand stretched up past the head for the nut
    expect(glitchesOf({ L: { x: 100, y: 205 }, R: { x: 182, y: 49 } }, null)).toEqual(["reach"]);
    expect(glitchesOf({ L: { x: ANCHOR.shoulderL.x - REACH_PX + 4, y: 170 }, R: { x: 140, y: 205 } }, null)).toEqual([]);
  });

  it("flags an arm laid across the chest, but not one coming across lower down", () => {
    // the old clarinet: the lower paw level with the far shoulder
    expect(glitchesOf({ L: { x: 168, y: 172 }, R: { x: 175, y: 140 } }, null)).toEqual(["across"]);
    // a bassist's pizz or a sax's lower stack crosses the belly, which is how they're played
    expect(acrossBy("L", { x: 168, y: 210 }, SH)).toBe(0);
    // a sax's upper hand just past the far shoulder is a normal hold
    expect(glitchesOf({ L: { x: 153, y: 178 }, R: { x: 160, y: 214 } }, null)).toEqual([]);
  });

  it("measures against the shoulders where they're drawn", () => {
    // the vibist has walked left: a paw left of the resting shoulder is still in front of them
    const walked = { L: { x: ANCHOR.shoulderL.x - 26, y: 170 }, R: { x: ANCHOR.shoulderR.x - 26, y: 170 } };
    expect(glitchesOf({ L: { x: 40, y: 160 }, R: { x: 70, y: 160 } }, null)).toEqual(["across"]);
    expect(glitchesOf({ L: { x: 40, y: 160 }, R: { x: 70, y: 160 } }, null, walked)).toEqual([]);
  });
});
