import { describe, expect, it } from "vitest";
import { asRecord, asString, extractJson, parseBarRange } from "./json";

// Replies as models actually send them: chatty, fenced, sloppy, or cut off by the token limit.
describe("extractJson", () => {
  const cases: [name: string, reply: string, value: unknown, repaired: boolean][] = [
    ["bare object", '{"a":1}', { a: 1 }, false],
    ["prose around it", 'Sure! Here is the plan:\n{"a":1,"b":[2,3]}\nHope that helps.', { a: 1, b: [2, 3] }, false],
    ["json fence", 'Okay.\n```json\n{"a":1}\n```\nDone.', { a: 1 }, false],
    ["bare fence", "```\n{\"a\":1}\n```", { a: 1 }, false],
    ["first of two objects", '{"a":1}\n{"a":2}', { a: 1 }, false],
    ["braces inside strings", '{"cue":"hit the } and { ...","n":1}', { cue: "hit the } and { ...", n: 1 }, false],
    ["escaped quotes", '{"cue":"she said \\"go\\" }","n":1}', { cue: 'she said "go" }', n: 1 }, false],
    ["trailing commas", '{"bars":[1,2,],"x":{"y":1,},}', { bars: [1, 2], x: { y: 1 } }, true],
    ["cut off mid-array", '{"bars":[{"bar":1,"texture":"groove"},{"bar":2', { bars: [{ bar: 1, texture: "groove" }, { bar: 2 }] }, true],
    ["cut off mid-string", '{"bars":[{"bar":1,"cue":"build to the', { bars: [{ bar: 1, cue: "build to the" }] }, true],
    ["cut off after a colon", '{"a":1,"b":', { a: 1, b: null }, true],
    ["cut off after a key", '{"a":1,"b"', { a: 1 }, true],
    ["cut off inside a key", '{"bars":[{"bar":1,"tex', { bars: [{ bar: 1 }] }, true],
    ["cut off inside a string in an array", '{"a":["x","y', { a: ["x", "y"] }, true],
    ["cut off inside a value string", '{"a":"x', { a: "x" }, true],
    ["cut off after a comma", '{"a":[1,2,', { a: [1, 2] }, true],
  ];
  for (const [name, reply, value, repaired] of cases) {
    it(name, () => {
      const r = extractJson(reply);
      expect(r.value).toEqual(value);
      if (repaired) expect(r.error).toMatch(/repaired/);
      else expect(r.error).toBeUndefined();
    });
  }

  it("says so when there's no object", () => {
    expect(extractJson("I'd rather not.")).toEqual({ value: null, error: "no JSON object in reply" });
    expect(extractJson("[1,2,3]").value).toBeNull();
  });

  it("gives up cleanly on garbage", () => {
    const r = extractJson("{ this is : not json }");
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/unparseable JSON/);
  });
});

describe("json helpers", () => {
  it("asRecord only accepts plain objects", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asRecord("x")).toEqual({});
  });
  it("asString takes strings and numbers, capped", () => {
    expect(asString("abc", 2)).toBe("ab");
    expect(asString(7)).toBe("7");
    expect(asString(null)).toBeUndefined();
    expect(asString({})).toBeUndefined();
  });
  it("parseBarRange reads numbers, ranges and en-dashes", () => {
    expect(parseBarRange(5)).toEqual([5]);
    expect(parseBarRange("5")).toEqual([5]);
    expect(parseBarRange("5-8")).toEqual([5, 6, 7, 8]);
    expect(parseBarRange(" 5 – 7 ")).toEqual([5, 6, 7]);
    expect(parseBarRange("8-5")).toEqual([5, 6, 7, 8]);
    expect(parseBarRange("1-1000")).toHaveLength(64);
    expect(parseBarRange("bars 5 to 8")).toEqual([]);
    expect(parseBarRange(NaN)).toEqual([]);
    expect(parseBarRange(undefined)).toEqual([]);
  });
});
