import { describe, expect, it } from "vitest";
import { DRUM } from "@/music/instruments";
import { LANES } from "@/music/notation";
import { acousticKitPreset, DEFAULT_SOUNDS, lm2Sample, packChain, readSounds } from "./packs";

describe("the acoustic kit", () => {
  const preset = acousticKitPreset();
  const regions = preset.groups.flatMap((g) => g.regions.map((r) => ({ ...r, group: g })));
  const covering = (note: number, vel: number) =>
    regions.filter((r) => r.keyRange![0] <= note && note <= r.keyRange![1] && (!r.velRange || (r.velRange[0] <= vel && vel <= r.velRange[1])));

  it("plays every drum the parts and the LinnDrum can", () => {
    const notes = new Set([...Object.values(DRUM), ...Object.values(LANES)].filter((n) => lm2Sample(n, 0.7) !== null));
    for (const note of notes) for (const vel of [1, 40, 64, 100, 127]) expect(covering(note, vel).length, `note ${note} vel ${vel}`).toBeGreaterThan(0);
  });

  it("alternates round-robins and keeps every layer's trim modest", () => {
    const snare = covering(DRUM.snare, 100);
    expect(snare.map((r) => r.seqPosition).sort()).toEqual([1, 2]);
    for (const r of regions) expect(Math.abs(r.volume ?? 0)).toBeLessThanOrEqual(24);
    // softer layers are trimmed to sit under louder ones
    const hat = [1, 127].map((v) => covering(DRUM.hatClosed, v)[0].volume);
    expect(hat[0]).not.toBe(hat[1]);
  });

  it("chokes the open hat with the closed and pedal hat", () => {
    const open = covering(DRUM.hatOpen, 100)[0].group;
    for (const n of [DRUM.hatClosed, DRUM.hatPedal]) expect(covering(n, 100)[0].group.group).toBe(open.offBy);
  });
});

describe("sounds", () => {
  it("reads old saves and unknown values back as sounds we have", () => {
    expect(readSounds(undefined, "splendid")).toEqual({ piano: "splendid", drums: "acoustic" });
    expect(readSounds({ piano: "harpsichord", drums: "808" })).toEqual(DEFAULT_SOUNDS);
    expect(readSounds({ piano: "wurlitzer", drums: "lm2" })).toEqual({ piano: "wurlitzer", drums: "lm2" });
  });
  it("falls back from every sampled pack", () => {
    expect(packChain("drums").map((p) => p.pack)).toEqual(["vcsl:acoustic-kit", "lm-2"]);
    expect(packChain("piano", { piano: "wurlitzer", drums: "acoustic" }).length).toBeGreaterThan(1);
  });
});
