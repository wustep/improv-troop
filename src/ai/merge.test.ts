import { describe, expect, it } from "vitest";
import { defaultMembers, INSTRUMENTS } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { isFeaturedRole } from "@/music/realize";
import type { Member } from "@/music/types";
import { enforceSlots, mergePlan, resolveMember, validateBarText, validateMotif } from "./merge";

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
});

describe("validateMotif", () => {
  it("needs a motif with at least two notes", () => {
    const repairs: string[] = [];
    expect(validateMotif(undefined, "", frame, fox, repairs)).toBeNull();
    expect(validateMotif("C5/1", "", frame, fox, repairs)).toBeNull();
    expect(repairs.join("|")).toMatch(/no motif given\|.*too few notes/);
  });
  it("keeps two bars at most and folds into the leader's range", () => {
    const repairs: string[] = [];
    const m = validateMotif("C2/4 D2/4 E2/4 F2/4 | G2/1 | A2/1", "low", frame, fox, repairs)!;
    const [lo, hi] = INSTRUMENTS.trumpet.range;
    expect(m.notes.length).toBe(5);
    expect(m.notes.every((n) => n.pitch >= lo && n.pitch <= hi)).toBe(true);
    expect(repairs.join()).toMatch(/folded/);
  });
  it("caps it at 16 notes", () => {
    const m = validateMotif(Array(20).fill("C5/16").join(" "), "", frame, fox, [])!;
    expect(m.notes.length).toBe(16);
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
  it("roles follow the directives", () => {
    const p = structuredClone(plan);
    p[free].directives = { ...p[free].directives, bear: "@rest" };
    expect(enforceSlots(p, frame, band, [])[free].roles.bear).toBe("rest");
    p[free].directives = { ...p[free].directives, bear: "@stride" };
    expect(bear.instrument).toBe("piano");
    expect(enforceSlots(p, frame, band, [])[free].roles.bear).toBe("comp");
  });
});
