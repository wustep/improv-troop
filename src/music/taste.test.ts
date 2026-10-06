import { describe, expect, it } from "vitest";
import { ANIMALS, ANIMAL_LIST, SOLO_OPENERS, defaultMembers } from "./instruments";
import { defaultSettings, generateLocal } from "./local";
import { parseMotifOps } from "./motif";
import type { Member } from "./types";

// Mochi (cat) leaves space and comes at the tune sideways; Clover (rabbit) loves a sequence and
// long busy lines. Over many takes, the local band should sound like them.
const band: Member[] = [
  ...defaultMembers(),
  { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" },
  { id: "bunny", animal: "bunny", name: "Clover", instrument: "violin" },
];

function soloDirectives(seeds: number) {
  const out: Record<string, string[]> = { cat: [], bunny: [] };
  const openers: Record<string, string[]> = { cat: [], bunny: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const { frame, plan } = generateLocal({ ...defaultSettings(band), style: "swing", bars: 32, seed, soloists: ["cat", "bunny"] }, band).score;
    for (const s of frame.sections) {
      if (s.kind !== "solo") continue;
      const id = s.featured?.[0];
      if (!id || !(id in out)) continue;
      openers[id].push(plan[s.start].directives?.[id] ?? "");
      for (let b = s.start; b < s.start + s.length; b++) out[id].push(plan[b].directives?.[id] ?? "");
    }
  }
  return { out, openers };
}

const share = (xs: string[], pred: (x: string) => boolean) => xs.filter(pred).length / Math.max(1, xs.length);

describe("players solo in character", () => {
  const { out, openers } = soloDirectives(80);

  it("each reaches for their favourite ways to open up the tune", () => {
    expect(share(openers.cat, (d) => d.startsWith("@motif displace"))).toBeGreaterThan(share(openers.bunny, (d) => d.startsWith("@motif displace")));
    expect(share(openers.bunny, (d) => d.startsWith("@motif seq"))).toBeGreaterThan(share(openers.cat, (d) => d.startsWith("@motif seq")));
  });

  it("but nobody is limited to their favourites", () => {
    expect(new Set(openers.cat.filter((d) => d.startsWith("@motif"))).size).toBeGreaterThan(3);
  });

  it("Mochi leaves space, Clover runs", () => {
    expect(share(out.cat, (d) => d === "@line sparse")).toBeGreaterThan(share(out.bunny, (d) => d === "@line sparse"));
    expect(share(out.bunny, (d) => d === "@line run")).toBeGreaterThan(share(out.cat, (d) => d === "@line run"));
  });

  it("every animal's taste names openers the engine can play", () => {
    for (const a of ANIMAL_LIST) {
      const t = ANIMALS[a].taste;
      for (const o of Object.keys(t.openers)) expect(SOLO_OPENERS).toContain(o);
      expect(t.answers).toBeGreaterThanOrEqual(0);
      expect(t.answers).toBeLessThanOrEqual(1);
    }
    for (const o of SOLO_OPENERS) expect(parseMotifOps(o.split(/\s+/).slice(1)).length, o).toBeGreaterThan(0);
  });
});
