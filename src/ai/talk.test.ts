import { describe, expect, it } from "vitest";
import { buildFrame } from "@/music/form";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings } from "@/music/local";
import type { ChatMessage } from "@/music/types";
import { checkChordNames, isFiller, TalkGate } from "./talk";

const band = defaultMembers();
// swing in Bb: Bbmaj7 Gm7 | Cm7 F7 | ... Eb7 ... Dm7 G7 ...
const frame = buildFrame({ ...defaultSettings(band), seed: 11, soloists: ["bear"] }, band);
const has = (s: string) => frame.chords.flat().some((c) => c.symbol === s);
const msg = (from: string, text: string): ChatMessage => ({ id: text, from, text, phase: "jam" });

describe("chord names in band talk", () => {
  it("keeps chords the chart plays and the prose around them", () => {
    expect(has("G7")).toBe(true);
    expect(checkChordNames("Riding steady into that G7 turn.", frame)).toBe("Riding steady into that G7 turn.");
    // bare letters are notes or words, not chords
    expect(checkChordNames("A big finish on the Bb, then step to C.", frame)).toBe("A big finish on the Bb, then step to C.");
  });
  it("gives a real root its chart quality, and drops a sentence about a chord that isn't there", () => {
    expect(has("Cm7") && !has("C7")).toBe(true);
    expect(checkChordNames("Land hard, then step into C7!", frame)).toBe("Land hard, then step into Cm7!");
    expect(checkChordNames("Bold head. Then we hit E7 hard.", frame)).toBe("Bold head.");
    expect(checkChordNames("We hit E7 hard.", frame)).toBeNull();
  });
});

describe("who talks", () => {
  it("drops bandstand filler and lines that repeat what was just said", () => {
    expect(isFiller("Holding pocket under your motif—steady and locked, landing clean.", [])).toBe(true);
    const chat = [msg("frog", "Walking quarters into the bridge, chromatic approaches.")];
    expect(isFiller("Walking quarters, chromatic approaches into the bridge.", chat)).toBe(true);
    expect(isFiller("Bruno's climbing—snare answers on the turn into F.", chat)).toBe(false);
    expect(isFiller("Locking tight—landing those chromatic approaches clean into the changes.", [])).toBe(true);
    expect(isFiller("Here we go!", [])).toBe(false);
  });
  it("gives each phrase two lines at most, and an accompanist every other phrase", () => {
    const gate = new TalkGate(frame, 4);
    expect(gate.allow("frog", "Snare answers your run in bar two.", 0, false, [])).toBeTruthy();
    expect(gate.allow("bear", "Comping under the trumpet with Charleston hits.", 1, false, [])).toBeTruthy();
    expect(gate.allow("owl", "Fill into the head on the ride bell.", 2, false, [])).toBeNull(); // phrase full
    expect(gate.allow("frog", "Taking the bass up an octave for the solo.", 4, false, [])).toBeNull(); // spoke last phrase
    expect(gate.allow("fox", "My answer climbs to the high D.", 5, true, [])).toBeTruthy(); // featured: no cooldown
    expect(gate.allow("frog", "Dropping to a two-feel under the out head.", 9, false, [])).toBeTruthy();
  });
});
