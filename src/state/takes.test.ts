import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { addTake, loadTakes, MAX_TAKES, saveTakes, type Take } from "./takes";

const band = defaultMembers();
const score = generateLocal({ ...defaultSettings(band), seed: 7 }, band).score;
const take = (n: number): Take => ({ id: `take-${n}`, score: { ...score, id: `take-${n}` }, label: `#${n}`, engine: "local", createdAt: n });

function fakeStorage(limit = Infinity) {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException("full", "QuotaExceededError");
      store.set(k, v);
    },
  };
}

describe("takes", () => {
  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("keep as many after a reload as the list shows", () => {
    let takes: Take[] = [];
    for (let n = 1; n <= MAX_TAKES + 3; n++) takes = addTake(takes, take(n));
    expect(takes).toHaveLength(MAX_TAKES);
    saveTakes(takes);
    expect(loadTakes().map((t) => t.id)).toEqual(takes.map((t) => t.id));
  });

  it("replace an older copy of the same chart", () => {
    const takes = addTake(addTake([take(1), take(2)], take(3)), { ...take(1), label: "again" });
    expect(takes.map((t) => t.label)).toEqual(["again", "#3", "#2"]);
  });

  it("keep the newest that fit when storage is full", () => {
    const one = JSON.stringify([take(1)]).length;
    vi.stubGlobal("localStorage", fakeStorage(one * 5));
    const takes = Array.from({ length: MAX_TAKES }, (_, i) => take(MAX_TAKES - i));
    saveTakes(takes);
    expect(loadTakes().map((t) => t.id)).toEqual(takes.slice(0, 3).map((t) => t.id));
  });

  it("drop saved entries that aren't takes", () => {
    localStorage.setItem("jamming:takes:v1", JSON.stringify([take(1), null, { id: "x" }, { ...take(2), score: { ...score, members: [{ animal: "dodo", instrument: "kazoo" }] } }]));
    expect(loadTakes().map((t) => t.id)).toEqual(["take-1"]);
    localStorage.setItem("jamming:takes:v1", "{}");
    expect(loadTakes()).toEqual([]);
  });
});
