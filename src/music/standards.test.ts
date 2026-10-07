import { describe, expect, it } from "vitest";
import { STANDARDS, searchStandards } from "./standards";

describe("searchStandards", () => {
  const ids = (q: string) => searchStandards(q).map((s) => s.id);

  it("keeps every tune for an empty query", () => {
    expect(searchStandards("   ")).toHaveLength(STANDARDS.length);
  });
  it("matches names ignoring case and accents", () => {
    expect(ids("autumn")).toEqual(["autumn"]);
    expect(ids("frere")).toEqual(["frere-jacques"]);
    expect(ids("IPANEMA")).toEqual(["girl-from-ipanema"]);
  });
  it("needs every word, and finds tunes by feel, key and meter", () => {
    expect(ids("bossa")).toContain("blue-bossa");
    expect(ids("bossa minor").every((id) => STANDARDS.find((s) => s.id === id)!.key.mode === "minor")).toBe(true);
    expect(ids("waltz")).toEqual(expect.arrayContaining(["jazz-waltz", "all-blues", "someday"]));
    expect(ids("blues bb")).toEqual(expect.arrayContaining(["blue-monk", "tenor-madness"]));
  });
  it("comes back empty when nothing matches", () => {
    expect(ids("zzz nope")).toEqual([]);
  });
});
