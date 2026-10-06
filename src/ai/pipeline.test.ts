import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings } from "@/music/local";
import type { Member, Score } from "@/music/types";
import { useDebug } from "@/state/debug";
import { pickCandidate, runComposer, type PipelineHooks } from "./composer";
import { startImproviser } from "./improviser";
import { fakeModel } from "./mock";

function installFakeFetch(latencyMs = 0) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    const text = fakeModel(body);
    return new Response(JSON.stringify({ text, usage: { inputTokens: 100, outputTokens: 50 }, serverMs: 5 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function hooks(runId: string): PipelineHooks & { scores: Score[]; chat: string[] } {
  const scores: Score[] = [];
  const chat: string[] = [];
  useDebug.getState().startRun(runId, "test");
  return {
    runId,
    apiKey: "test-key",
    signal: new AbortController().signal,
    onStatus: () => {},
    onChat: (m) => chat.push(`${m.from}: ${m.text}`),
    onScore: (s) => scores.push(s),
    scores,
    chat,
  };
}

const band: Member[] = defaultMembers();

afterEach(() => vi.unstubAllGlobals());

describe("composer pipeline", () => {
  it("plans best-of-N, judges, writes featured parts, and keeps the frame locked", async () => {
    const fetch = installFakeFetch();
    const settings = { ...defaultSettings(band), mode: "composer" as const, bestOf: 2, soloists: ["bear"] };
    const h = hooks("t-comp");
    const score = await runComposer(settings, band, h);
    expect(score.frame.bars).toBe(16);
    expect(score.plan.length).toBe(16);
    expect(score.critic?.chosen).toBe(2);
    // two plans + judge + one parts call per featured player (leader + soloist)
    expect(fetch.mock.calls.length).toBe(2 + 1 + 2);
    // the soloist's bars were given a pattern by the "director" but slots are enforced
    const soloBars = score.frame.sections.find((s) => s.kind === "solo")!;
    for (let b = soloBars.start; b < soloBars.start + soloBars.length; b++) {
      expect(score.plan[b].roles.bear).toBe("solo");
      expect(score.plan[b].directives?.bear).not.toMatch(/^@(comp|rest)/);
    }
    // the out-of-frame bar 17 was ignored and recorded
    const calls = useDebug.getState().calls.filter((c) => c.runId === "t-comp");
    expect(calls.some((c) => c.repairs.some((r) => r.includes("outside the 16-bar frame")))).toBe(true);
    // the leader's head bars got written notes
    expect(score.plan[1].directives?.fox).toMatch(/Bb4\/8/);
    expect(score.parts.fox.length).toBeGreaterThan(10);
    expect(score.motif.text).toContain("F4");
  });
});

describe("improviser pipeline", () => {
  it("counts off, talks, and builds the chart phrase by phrase", async () => {
    const fetch = installFakeFetch();
    const settings = { ...defaultSettings(band), mode: "improviser" as const, soloists: ["bear"] };
    const h = hooks("t-imp");
    const ctl = startImproviser(settings, band, h);
    const score = await ctl.promise;
    expect(score.frame.bars).toBe(16);
    expect(ctl.readyBars()).toBe(16);
    // leader + 3 replies + per-phrase featured and accompanist calls
    expect(fetch.mock.calls.length).toBeGreaterThan(4 + 4);
    expect(h.chat.some((c) => c.startsWith("fox: Medium swing"))).toBe(true);
    expect(h.chat.some((c) => c.includes("Got it"))).toBe(true);
    expect(score.chat.some((c) => c.phase === "jam")).toBe(true);
    // the arc landed on the plan
    expect(score.plan[14].dynamic).toBe("ff");
    // partial scores streamed out before the end
    expect(h.scores.length).toBeGreaterThan(2);
    for (const m of band) expect(score.parts[m.id].length).toBeGreaterThan(0);
    // the drummer's written grid made it into the plan
    expect(Object.values(score.plan).some((bp) => bp.directives?.owl?.startsWith("rd:"))).toBe(true);
  });

  it("vamps on autopilot when playback catches up", async () => {
    installFakeFetch(15);
    const settings = { ...defaultSettings(band), mode: "improviser" as const, soloists: ["bear"] };
    const h = hooks("t-auto");
    const ctl = startImproviser(settings, band, h);
    // wait for the count-off + first phrase
    while (ctl.readyBars() < 4) await new Promise((r) => setTimeout(r, 1));
    expect(ctl.ensureReady(9)).toBe(true);
    expect(ctl.readyBars()).toBeGreaterThanOrEqual(12);
    const score = await ctl.promise;
    expect(score.notes.some((n) => n.includes("Autopilot"))).toBe(true);
    for (const m of band) {
      const starts = score.parts[m.id].map((n) => n.start);
      // no duplicated phrases: onsets strictly non-decreasing and unique per pitch
      const sorted = [...starts].sort((a, b) => a - b);
      expect(starts).toEqual(sorted);
    }
  });
});

describe("improviser pacing", () => {
  it("pipelines phrases: the next soloist thinks while the band answers", async () => {
    installFakeFetch(20);
    const settings = { ...defaultSettings(band), mode: "improviser" as const, soloists: ["bear"] };
    const h = hooks("t-pipe");
    const ctl = startImproviser(settings, band, h);
    await ctl.promise;
    const calls = useDebug.getState().calls.filter((c) => c.runId === "t-pipe");
    const phraseCalls = calls.filter((c) => /^bars /.test(c.label));
    // the featured call for bars 5-8 starts before the band's calls for bars 1-4 have all finished
    const nextSolo = phraseCalls.find((c) => c.label.startsWith("bars 5") && c.agent === "bear")!;
    const bandFirst = phraseCalls.filter((c) => c.label.startsWith("bars 1") && c.agent !== "fox");
    const bandFirstDone = Math.max(...bandFirst.map((c) => c.startedAt + (c.ms ?? 0)));
    expect(nextSolo.startedAt).toBeLessThan(bandFirstDone);
    expect(ctl.readyToPlay(0.375)).toBe(true);
  });
});

describe("pickCandidate", () => {
  const sc = (candidate: number, score: number) => ({ candidate, distinctiveness: score, coherence: score, score, notes: "" });
  it("goes with the judge's scores over the favourite it named", () => {
    expect(pickCandidate([sc(1, 9), sc(2, 2)], 2, [1, 2])).toBe(1);
  });
  it("lets the named favourite break a tie, else the lower number", () => {
    expect(pickCandidate([sc(1, 7), sc(2, 7), sc(3, 4)], 2, [1, 2, 3])).toBe(2);
    expect(pickCandidate([sc(1, 7), sc(2, 7)], 9, [1, 2])).toBe(1);
  });
  it("ignores scores for candidates that don't exist", () => {
    expect(pickCandidate([sc(5, 10), sc(2, 3)], 0, [1, 2])).toBe(2);
    expect(pickCandidate([], 2, [1, 2])).toBe(2);
    expect(pickCandidate([], 7, [1, 2])).toBeUndefined();
  });
});
