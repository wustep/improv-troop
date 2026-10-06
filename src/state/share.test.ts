import { describe, expect, it } from "vitest";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { STANDARDS } from "@/music/standards";
import type { Member } from "@/music/types";
import { decodeShare, encodeShare, sharedFromHash, shareUrl } from "./share";

const band: Member[] = [...defaultMembers(), { id: "sheep", animal: "sheep", name: "Olive ☁", instrument: "cello" }];

function replay(value: string) {
  const shared = decodeShare(value)!;
  expect(shared).not.toBeNull();
  return generateLocal({ ...defaultSettings(shared.members), ...shared.settings }, shared.members).score;
}

describe("share links", () => {
  it("replay the same take", () => {
    const settings = { ...defaultSettings(band), style: "bossa" as const, seed: 98765, tempo: 132, bars: 32, mode: "composer" as const };
    const take = generateLocal(settings, band).score;
    const again = replay(encodeShare(take));
    expect(again.parts).toEqual(take.parts);
    expect(again.chat.map((c) => c.text)).toEqual(take.chat.map((c) => c.text));
    expect(again.members).toEqual(take.members);
  });

  it("replay a standard", () => {
    const std = STANDARDS[0];
    const settings = { ...defaultSettings(band), style: std.style, standard: std.id, key: { ...std.key }, bars: std.bars.length, seed: 42 };
    const take = generateLocal(settings, band).score;
    expect(replay(encodeShare(take)).parts).toEqual(take.parts);
  });

  it("round-trip through a URL hash", () => {
    const take = generateLocal({ ...defaultSettings(band), seed: 7 }, band).score;
    const url = new URL(shareUrl(take, "https://example.com/?debug"));
    expect(url.search).toBe("?debug");
    expect(sharedFromHash(url.hash)?.settings.seed).toBe(7);
  });

  it("reject tampered or unknown links", () => {
    const take = generateLocal({ ...defaultSettings(band), seed: 7 }, band).score;
    const good = encodeShare(take);
    const edit = (f: (p: { s: Record<string, unknown>; m: unknown[][] }) => void) => {
      const p = JSON.parse(Buffer.from(good.slice(2), "base64url").toString());
      f(p);
      return `1.${Buffer.from(JSON.stringify(p)).toString("base64url")}`;
    };
    expect(decodeShare("2." + good.slice(2))).toBeNull();
    expect(decodeShare("1.!!!")).toBeNull();
    expect(decodeShare("1.e30")).toBeNull();
    expect(decodeShare(edit((p) => (p.s.style = "polka")))).toBeNull();
    expect(decodeShare(edit((p) => (p.m[0][1] = "dragon")))).toBeNull();
    expect(decodeShare(edit((p) => (p.m[0][3] = "theremin")))).toBeNull();
    expect(decodeShare(edit((p) => (p.m[0][1] = "__proto__")))).toBeNull();
    expect(decodeShare(edit((p) => (p.s.key = { tonic: "<b>", mode: "major" })))).toBeNull();
    expect(decodeShare(edit((p) => (p.s.tempo = 10_000)))?.settings.tempo).toBe(320);
    expect(decodeShare(edit((p) => (p.s.leaderId = "nobody")))?.settings.leaderId).toBe("");
  });
});
