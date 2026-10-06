import { describe, expect, it } from "vitest";
import { rowOf, rowRange, uniformRows } from "./model";
import { breakSystems, systemWidth, type ChartMeasure } from "./render";

const measure = (minW: number[]): ChartMeasure => ({ minW, begFirst: 110, beg: 70, plain: 5 });

describe("systems", () => {
  it("packs as many bars as fit, up to the limit", () => {
    const m = measure(Array(8).fill(120));
    const starts = breakSystems(m, 940, 4);
    expect(starts).toEqual([0, 4]);
    for (let r = 0; r < starts.length; r++) expect(systemWidth(m, starts[r], starts[r + 1] ?? 8)).toBeLessThanOrEqual(940);
    expect(breakSystems(m, 940, 2)).toEqual([0, 2, 4, 6]);
  });

  it("gives a busy bar fewer neighbours instead of clipping it", () => {
    const m = measure([150, 150, 700, 150, 150, 150]);
    const starts = breakSystems(m, 940, 4);
    expect(starts).toContain(2);
    expect(starts).toContain(3);
  });

  it("doesn't strand the last bar on its own system", () => {
    const starts = breakSystems(measure(Array(13).fill(150)), 940, 4);
    expect(13 - starts[starts.length - 1]).toBeGreaterThan(1);
  });

  it("finds a bar's system", () => {
    const model = { rowStart: [0, 3, 5], bars: 7 };
    expect([0, 2, 3, 4, 5, 6].map((b) => rowOf(model, b))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(rowRange(model, 1)).toEqual([3, 5]);
    expect(rowRange(model, 2)).toEqual([5, 7]);
    expect(uniformRows(10, 4)).toEqual([0, 4, 8]);
  });
});
