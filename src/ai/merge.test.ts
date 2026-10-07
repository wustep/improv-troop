import { describe, expect, it } from "vitest";
import { defaultMembers, INSTRUMENTS } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { motifFromText } from "@/music/motif";
import { isFeaturedRole } from "@/music/realize";
import type { Member } from "@/music/types";
import { accompanimentFits, applyDefault, enforceSlots, mergePlan, registerShift, resolveMember, shiftOctaves, usualDirective, validateBarText, validateMotif } from "./merge";

// bear piano, frog bass, owl drums, fox trumpet (leader), cat sax (soloist)
const band: Member[] = [...defaultMembers(), { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" }];
const { score } = generateLocal({ ...defaultSettings(band), bars: 32, seed: 3, soloists: ["cat"] }, band);
const { frame, plan } = score;
const [bear, , owl, fox] = band;
// a bar where the pianist is free to take any part
const free = plan.findIndex((b) => !b.directives?.bear?.startsWith("@head") && !isFeaturedRole(frame.slots[b.index]?.bear));

describe("resolveMember", () => {
  it("matches ids, names and loose descriptions", () => {
    expect(resolveMember("fox", band)?.id).toBe("fox");
    expect(resolveMember("  RUSTY ", band)?.id).toBe("fox");
    expect(resolveMember("Rusty the fox", band)?.id).toBe("fox");
    expect(resolveMember("mochi (sax)", band)?.id).toBe("cat");
    expect(resolveMember("the tuba", band)).toBeUndefined();
  });
});

describe("validateBarText", () => {
  const check = (text: string, m: Member) => {
    const repairs: string[] = [];
    return { out: validateBarText(text, m, 4, repairs, "bar 1"), repairs };
  };
  it("keeps a directive's first line", () => {
    expect(check("@motif invert\nthen something", fox)).toEqual({ out: "@motif invert", repairs: [] });
  });
  it("keeps clean notes as they are", () => {
    expect(check("C5/4 D5/4 E5/4 G5/4", fox)).toEqual({ out: "C5/4 D5/4 E5/4 G5/4", repairs: [] });
  });
  it("keeps only the first bar of a multi-bar cell", () => {
    expect(check("C5/2 D5/2 | E5/1", fox).out).toBe("C5/2 D5/2");
  });
  it("pads a short bar and says so", () => {
    const r = check("C5/4", fox);
    expect(r.out).toBe("C5/4");
    expect(r.repairs.join()).toMatch(/padded/);
  });
  it("drops a drum grid given to a horn, and notes given to drums", () => {
    const a = check("hh:x.x.x.x. sd:..x...x.", fox);
    expect(a.out).toBeNull();
    expect(a.repairs.join()).toMatch(/drum grid/);
    const b = check("C5/4 D5/4 E5/4 G5/4", owl);
    expect(b.out).toBeNull();
    expect(b.repairs.join()).toMatch(/notes for drums/);
    expect(check("hh:x.x.x.x. sd:..x...x.", owl).out).toBe("hh:x.x.x.x. sd:..x...x.");
  });
  it("falls back on unreadable notes", () => {
    const r = check("play something bluesy", fox);
    expect(r.out).toBeNull();
    expect(r.repairs.join()).toMatch(/unreadable/);
    expect(check("   ", fox).out).toBeNull();
  });
  it("accepts a bar of rests", () => {
    expect(check("r/1", fox).out).toBe("r/1");
  });
  it("moves a line written an octave high down as a whole, keeping its shape", () => {
    // trumpet tops out at C6 (84): the top two notes would otherwise fold mid-phrase
    const r = check("G5/8 A5/8 C6/8 D6/8 E6/4> r/4", fox);
    expect(r.out).toBe("G4/8 A4/8 C5/8 D5/8 E5/4> r/4");
    expect(r.repairs.join()).toMatch(/moved down an octave/);
  });
  // the shapes real models sent through the AI Gateway
  it("squeezes an over-full bar back in, keeping every pitch and the landing", () => {
    // 5 beats: the rest goes
    expect(check("D5/8 Bb4/8 F5/4 r/4 D5/8 C5/8 Bb4/4", fox).out).toBe("D5/8 Bb4/8 F5/4 D5/8 C5/8 Bb4/4");
    // 6 beats: the rest, then the long notes before the last one give way
    const r = check("F4/8 A4/8 C5/8 Bb4/8 A4/4 r/8 G4/8 F4/4 Bb4/4", { ...fox, instrument: "sax" });
    const notes = r.out!.split(" ");
    expect(notes.map((n) => n.split("/")[0])).toEqual(["F4", "A4", "C5", "Bb4", "A4", "G4", "F4", "Bb4"]);
    expect(notes[notes.length - 1]).toBe("Bb4/4");
    expect(r.repairs.join()).toMatch(/6 beats in a 4-beat bar, squeezed/);
  });
  it("cuts a bar that is far too long instead of squeezing it", () => {
    const r = check("C5/2 D5/2 E5/2 F5/2", fox);
    expect(r.out).toBe("C5/2 D5/2 E5/2 F5/2");
    expect(r.repairs.join()).toMatch(/overflow/);
  });
  it("spells chord symbols written as notes", () => {
    const frog = band[1];
    expect(check("Bb2/4 r/4 Gm7/4 r/4", frog).out).toBe("Bb2/4 r/4 G2/4 r/4");
    // "Cm2" is a C2 with a minor chord's m in it
    expect(check("C2/4 Cm2/4 C2/4 B1/4", frog).out).toBe("C2/4 C2/4 C2/4 B1/4");
    // a symbol in front of real pitches just goes; on its own it's voiced
    expect(check("[Gm7 B3 D4]/8 r/8 Cm7/4 r/2", bear).out).toBe("[B3 D4]/8 r/8 [C4 Eb4 G4 Bb4]/4 r/2");
    expect(check("[Gm7 B3 D4]/8 r/8 r/4 r/2", bear).repairs.join()).toMatch(/chord symbols/);
    expect(check("[Bb D F A]/8 r/8 r/4 r/2", bear).out).toBe("[Bb3 D4 F4 A4]/8 r/8 r/4 r/2");
    // a comper's "F7" or "Bb9" is a chord (as a note it would be MIDI 101 or 130); a soloist's C6 is a note
    const comp = (t: string) => validateBarText(t, bear, 4, [], "bar 1", "comp");
    expect(comp("Bb9/16 r/16 F7/16 r/16 r/4 r/2")).toBe("[Bb3 D4 F4 Ab4]/16 r/16 [F4 A4 C5 Eb5]/16 r/16 r/4 r/2");
    expect(validateBarText("C6/4 B5/4 A5/2", bear, 4, [], "bar 1", "solo")).toBe("C6/4 B5/4 A5/2");
  });
  it("plays a part written out after its directive, and drops a directive tacked on the end", () => {
    const r = check("@motif D5/8 F5/8 r/8 F5/8 D5/8 C5/8 r/8 Bb4/8", fox);
    expect(r.out).toBe("D5/8 F5/8 r/8 F5/8 D5/8 C5/8 r/8 Bb4/8");
    expect(r.repairs.join()).toMatch(/played as written/);
    expect(check("@groove light rd:x...x.x.x...x.x. sd:....x.......x...", owl).out).toBe("rd:x...x.x.x...x.x. sd:....x.......x...");
    // words after a directive that aren't notes stay its business
    expect(check("@comp sparse Bbmaj7 rootless hits", bear).out).toMatch(/^@comp sparse/);
    expect(check("C5/4 D5/4 E5/2 @end", fox)).toEqual({ out: "C5/4 D5/4 E5/2", repairs: [] });
    expect(check("@end [Bb2 F3 D4]/1", bear).out).toBe("@end");
  });
  it("reads accents written before the duration or on their own", () => {
    expect(check("Bb1>/16 r/16 r/8 r/4 r/2", band[1]).repairs.join()).not.toMatch(/bad token/);
    expect(check("C5/4 D5/4 E5/2 >", fox).repairs).toEqual([]);
  });
  it("goes round again with a bass figure that fills half the bar", () => {
    const r = check("Bb2/8 r/8 G2/8 Bb2/8", band[1]);
    expect(r.out).toBe("Bb2/8 r/8 G2/8 Bb2/8 Bb2/8 r/8 G2/8 Bb2/8");
    // a horn's short phrase is a phrase, followed by space
    expect(check("C5/4 D5/4", fox).out).toBe("C5/4 D5/4");
  });
  it("keeps a short beat's gap inside that beat when the bar is written in beat groups", () => {
    const frog = band[1];
    // the second beat has three 16ths: the slip stays in beat 2, beats 3 and 4 stay on their beats
    const r = check("Bb2/16 r/16 F3/16 G3/16, Ab3/16 G3/16 F3/16, Bb2/16 C3/16 D3/16 C3/16, Bb2/16 r/16 Bb3/8", frog);
    expect(r.out).toBe("Bb2/16 r/16 F3/16 G3/16, Ab3/16 G3/16 F3/16 r/16, Bb2/16 C3/16 D3/16 C3/16, Bb2/16 r/16 Bb3/8");
    expect(r.repairs.join()).toMatch(/inside its beat/);
    // a beat with too much in it is squeezed inside the beat
    expect(check("Bb4/16 r/16 Bb4/8 C5/16 Bb4/16, F4/8 r/8, Bb4/8 C5/8, F4/8 D4/8", fox).out).toBe("Bb4/16 Bb4/16 C5/16 Bb4/16, F4/8 r/8, Bb4/8 C5/8, F4/8 D4/8");
    // a note held across a beat isn't beat groups: left to the usual checks
    expect(check("C5/8 D5/4, E5/8 F5/2", fox).out).toBe("C5/8 D5/4, E5/8 F5/2");
  });
  it("leaves a line alone when moving it wouldn't fit more notes", () => {
    expect(check("C5/4 D5/4 E5/4 G5/4", fox).repairs).toEqual([]);
    // one stray low note: shifting the rest up would push them out instead
    expect(check("F#3/4 C5/4 D5/4 E5/4", fox).out).toBe("F#3/4 C5/4 D5/4 E5/4");
  });
});

describe("directives that fit the player", () => {
  const frog = band[1]; // bass
  const olive: Member = { id: "sheep", animal: "sheep", name: "Olive", instrument: "cello" };
  const accompany = (text: string, m: Member, role: Parameters<typeof validateBarText>[5]) => {
    const repairs: string[] = [];
    return { out: validateBarText(text, m, 4, repairs, "bar 1", role), repairs };
  };
  it("keeps a comping pianist off the bass line and out of the melody", () => {
    const walk = accompany("@walk", bear, "comp");
    expect(walk.out).toBeNull();
    expect(walk.repairs.join()).toMatch(/@walk isn't something Bruno plays/);
    expect(accompany("@motif invert", bear, "comp").out).toBeNull();
    expect(accompany("@line dense", fox, "counter").out).toBeNull();
    expect(accompany("@comp sparse", bear, "comp").out).toBe("@comp sparse");
  });
  it("lets anyone rest, fill, hit, end or bring the head back", () => {
    for (const d of ["@rest", "@fill", "@hits", "@end", "@head 3"]) expect(accompany(d, frog, "bass").out).toBe(d);
  });
  it("lets a cello in the bass chair walk, and pluck anywhere", () => {
    expect(accompany("@walk", olive, "bass").out).toBe("@walk");
    expect(accompany("@walk", olive, "counter").out).toBeNull();
    expect(accompany("@pizz busy", olive, "counter").out).toBe("@pizz busy");
    expect(accompanimentFits("@pizz", fox)).toBe(false);
  });
  it("leaves featured players' directives to the slot check", () => {
    expect(accompany("@motif up 2", fox, "lead").out).toBe("@motif up 2");
    expect(accompany("@walk", fox, undefined).out).toBe("@walk");
  });
  it("is applied when merging a plan", () => {
    const repairs: string[] = [];
    const merged = mergePlan(plan, [{ bar: free + 1, parts: { bear: "@walk" } }], frame, band, repairs, { onlyBars: [free] });
    expect(merged[free].directives?.bear).toBe(plan[free].directives?.bear);
    expect(repairs.join()).toMatch(/@walk isn't something/);
  });
});

describe("register shifting", () => {
  it("picks the one octave move that fits the most notes, smallest on a tie", () => {
    expect(registerShift([60, 62, 64], 54, 84)).toBe(0);
    expect(registerShift([86, 88, 91], 54, 84)).toBe(-1);
    expect(registerShift([36, 40, 43], 54, 84)).toBe(2);
    expect(registerShift([], 54, 84)).toBe(0);
  });
  it("rewrites pitches only, in chords, ties and lowercase too", () => {
    expect(shiftOctaves("[C4 E4 Bb4]/2 A4/4~ A4/8 r/8", 1)).toBe("[C5 E5 Bb5]/2 A5/4~ A5/8 r/8");
    expect(shiftOctaves("eb5/8. f5/16' g5/4?", -1)).toBe("eb4/8. f4/16' g4/4?");
  });
});

describe("validateMotif", () => {
  it("needs a motif with at least two notes", () => {
    const repairs: string[] = [];
    expect(validateMotif(undefined, "", frame, fox, repairs)).toBeNull();
    expect(validateMotif("C5/1", "", frame, fox, repairs)).toBeNull();
    expect(repairs.join("|")).toMatch(/no motif given\|.*too few notes/);
  });
  it("keeps two bars at most and moves it whole into the leader's range", () => {
    const repairs: string[] = [];
    const m = validateMotif("C2/4 D2/4 E2/4 F2/4 | G2/1 | A2/1", "low", frame, fox, repairs)!;
    const [lo, hi] = INSTRUMENTS.trumpet.range;
    expect(m.notes.length).toBe(5);
    expect(m.notes.every((n) => n.pitch >= lo && n.pitch <= hi)).toBe(true);
    // the contour survives: same intervals, two octaves up
    expect(m.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65, 67]);
    expect(repairs.join()).toMatch(/moved up two octaves/);
    // the text everyone else reads says the same thing as the notes
    expect(m.text).not.toMatch(/[A-G][#b]?2\//);
    expect(m.text.split("|").length).toBe(2);
    const again = motifFromText(m.text, 4, m.chord);
    expect(again.notes.map((n) => [n.pitch, n.start, n.dur])).toEqual(m.notes.map((n) => [n.pitch, n.start, n.dur]));
  });
  it("leaves the model's text alone when nothing had to change", () => {
    const m = validateMotif("Bb4/8 C5/8 D5/4 r/2", "", frame, fox, [])!;
    expect(m.text).toBe("Bb4/8 C5/8 D5/4 r/2");
  });
  it("keeps a motif with a stray leap in range without bending its opening steps", () => {
    const repairs: string[] = [];
    const m = validateMotif("C5/4 D5/4 E5/4 C7/4", "", frame, fox, repairs)!;
    const [lo, hi] = INSTRUMENTS.trumpet.range;
    const p = m.notes.map((n) => n.pitch);
    expect([p[1] - p[0], p[2] - p[1]]).toEqual([2, 2]);
    expect(p.every((x) => x >= lo && x <= hi)).toBe(true);
  });
  it("caps it at 16 notes", () => {
    const m = validateMotif(Array(20).fill("C5/16").join(" "), "", frame, fox, [])!;
    expect(m.notes.length).toBe(16);
    expect(m.length).toBe(4);
    expect(motifFromText(m.text, 4, m.chord).notes.length).toBe(16);
  });
});

describe("mergePlan", () => {
  const merge = (entries: unknown, opts?: Parameters<typeof mergePlan>[5]) => {
    const repairs: string[] = [];
    return { plan: mergePlan(plan, entries, frame, band, repairs, opts), repairs };
  };
  it("keeps the local plan when the reply has no bars array", () => {
    const r = merge({ nope: true });
    expect(r.plan.map((b) => b.directives)).toEqual(enforceSlots(structuredClone(plan), frame, band, []).map((b) => b.directives));
    expect(r.repairs.join()).toMatch(/no bars array/);
  });

  it("applies texture, dynamic, cue and parts over a bar range", () => {
    const b1 = free + 1;
    const r = merge([{ bars: `${b1}-${b1 + 1}`, texture: "PEAK", dynamic: "ff", cue: "everyone in", parts: { Bruno: "@comp" } }]);
    for (const i of [free, free + 1]) {
      expect(r.plan[i].texture).toBe("peak");
      expect(r.plan[i].dynamic).toBe("ff");
      expect(r.plan[i].cue).toBe("everyone in");
    }
    expect(r.plan[free].directives?.bear).toBe("@comp");
    expect(r.plan[free].roles.bear).toBe("comp");
    expect(r.repairs.join()).toMatch(/not planned; kept the local plan/);
  });

  it("ignores bad values and says why", () => {
    const r = merge([{ bar: 999 }, { cue: "no bar" }, { bar: free + 1, texture: "loud", parts: { tuba: "@line" } }]);
    expect(r.plan[free].texture).toBe(plan[free].texture);
    const all = r.repairs.join("\n");
    expect(all).toMatch(/bar 999 is outside/);
    expect(all).toMatch(/without a bar number/);
    expect(all).toMatch(/unknown player "tuba"/);
  });

  it("keeps the melody where the tune comes back", () => {
    const i = plan.findIndex((b) => b.directives?.fox?.startsWith("@head"));
    expect(i).toBeGreaterThanOrEqual(0);
    const r = merge([{ bar: i + 1, parts: { fox: "@line long" } }]);
    expect(r.plan[i].directives?.fox).toBe(plan[i].directives?.fox);
    expect(r.repairs.join()).toMatch(/the tune comes back/);
  });

  it("only touches the bars and players it was asked about", () => {
    const r = merge(
      [
        { bar: free + 1, parts: { bear: "@comp", cat: "@line run" } },
        { bar: free + 2, parts: { bear: "@comp" } },
      ],
      { onlyBars: [free], onlyMembers: ["bear"] },
    );
    expect(r.plan[free].directives?.bear).toBe("@comp");
    expect(r.plan[free].directives?.cat).toBe(plan[free].directives?.cat);
    expect(r.plan[free + 1].directives?.bear).toBe(plan[free + 1].directives?.bear);
  });
});

describe("a featured player's own bars", () => {
  const solo = (text: string, m: Member = band[4], role: Parameters<typeof validateBarText>[5] = "solo") => {
    const repairs: string[] = [];
    return { out: validateBarText(text, m, 4, repairs, "bar 9", role), repairs };
  };
  it("can't be turned into comping, a pattern or a groove", () => {
    for (const d of ["@comp", "@pad", "@riff", "@walk", "@hits"]) {
      const r = solo(d);
      expect(r.out).toBeNull();
      expect(r.repairs.join()).toMatch(/isn't a featured part; Mochi keeps the plan/);
    }
    expect(solo("@groove", owl, "trade").out).toBeNull();
  });
  it("keeps the solo vocabulary, written notes and a drum break", () => {
    for (const d of ["@line dense", "@motif invert", "@answer", "@fill", "@head 3", "@rest"]) expect(solo(d).out).toBe(d);
    expect(solo("@solo", owl, "trade").out).toBe("@solo");
    expect(solo("C4/4 D4/4 E4/2").out).toBe("C4/4 D4/4 E4/2");
  });
});

describe("enforceSlots", () => {
  it("a featured player can't be handed accompaniment", () => {
    const i = frame.slots.findIndex((s) => s.cat === "solo");
    expect(i).toBeGreaterThanOrEqual(0);
    const p = structuredClone(plan);
    p[i].directives = { ...p[i].directives, cat: "@pad" };
    const repairs: string[] = [];
    const out = enforceSlots(p, frame, band, repairs);
    expect(out[i].directives?.cat).toBe("@line");
    expect(out[i].roles.cat).toBe("solo");
    expect(repairs.join()).toMatch(/Mochi is featured/);
  });
  it("an ending or a band hit mid-solo becomes the solo again", () => {
    const i = frame.slots.findIndex((s) => s.cat === "solo");
    const p = structuredClone(plan);
    p[i].directives = { ...p[i].directives, cat: "@end" };
    const out = enforceSlots(p, frame, band, []);
    expect(out[i].directives?.cat).toBe("@line");
  });
  it("roles follow the directives", () => {
    const p = structuredClone(plan);
    p[free].directives = { ...p[free].directives, bear: "@rest" };
    expect(enforceSlots(p, frame, band, [])[free].roles.bear).toBe("rest");
    p[free].directives = { ...p[free].directives, bear: "@stride" };
    expect(bear.instrument).toBe("piano");
    expect(enforceSlots(p, frame, band, [])[free].roles.bear).toBe("comp");
  });
});

describe("a bandmate's go-to directive", () => {
  const swing = generateLocal({ ...defaultSettings(band), bars: 32, seed: 3, soloists: ["cat"] }, band).score;
  it("swaps in for the usual part only, leaving the arranged bars alone", () => {
    const plan = swing.plan.map((b) => ({ ...b, directives: { ...b.directives } }));
    const before = plan.map((b) => b.directives?.frog);
    expect(usualDirective(plan, "frog")).toBe("@walk");
    expect(before).toContain("@two"); // the head in two
    const n = applyDefault(plan, "frog", "@walk busy");
    expect(n).toBe(before.filter((d) => d === "@walk").length);
    plan.forEach((b, i) => {
      if (before[i] === "@walk") expect(b.directives?.frog).toBe("@walk busy");
      else expect(b.directives?.frog).toBe(before[i]);
    });
  });
  it("keeps the drummer's light and peak grooves", () => {
    const plan = swing.plan.map((b) => ({ ...b, directives: { ...b.directives } }));
    const shaped = plan.filter((b) => /@groove (light|peak)/.test(b.directives?.owl ?? "")).length;
    expect(shaped).toBeGreaterThan(0);
    applyDefault(plan, "owl", "@groove");
    expect(plan.filter((b) => /@groove (light|peak)/.test(b.directives?.owl ?? "")).length).toBe(shaped);
  });
});

describe("mergePlan reads what models write", () => {
  const leaderHead = plan.findIndex((b) => b.directives?.fox?.startsWith("@head"));
  it("splits a range written bar by bar", () => {
    const repairs: string[] = [];
    const i = free;
    const out = mergePlan(plan, [{ bars: `${i + 1}-${i + 2}`, parts: { bear: "@comp sparse | @pad" } }], frame, band, repairs);
    expect(out[i].directives?.bear).toBe("@comp sparse");
    expect(out[i + 1].directives?.bear).toBe(plan[i + 1].directives?.bear?.startsWith("@head") ? plan[i + 1].directives?.bear : "@pad");
  });
  it("keeps the code's bar for a head coming back, whatever bar the model counted from", () => {
    const repairs: string[] = [];
    const locked = plan[leaderHead].directives!.fox;
    const out = mergePlan(plan, [{ bars: `${leaderHead + 1}`, parts: { fox: "@head 1" } }], frame, band, repairs);
    expect(out[leaderHead].directives?.fox).toBe(locked);
    expect(repairs.join()).toMatch(/kept @head/);
  });
});

describe("more shapes from real models", () => {
  const repairs: string[] = [];
  it("a bowed upright bass holds a pedal", () => {
    expect(validateBarText("@arco", band[1], 4, repairs, "bar 1", "bass")).toBe("@pedal");
  });
});
