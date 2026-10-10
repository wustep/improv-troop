// Real-model evaluation: runs the composer and improviser pipelines against the Vercel AI
// Gateway and scores what comes back with the app's own validators. Not part of `pnpm test`.
//
//   EVAL_MODELS=anthropic/claude-haiku-4.5,google/gemini-2.5-flash pnpm eval:gateway
//
// The key comes from IMPROV_TROOP_SERVER_KEY (or ANTHROPIC_API_KEY, for Claude models only) in
// .env.local, read by the /api/llm route itself; this file never reads, prints, or forwards it.
import { loadEnvFile } from "node:process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, it, vi } from "vitest";
import { POST } from "@/app/api/llm/route";
import { defaultMembers, INSTRUMENTS } from "@/music/instruments";
import { defaultSettings } from "@/music/local";
import { isFeaturedRole } from "@/music/realize";
import type { Member, Score, StyleId } from "@/music/types";
import { useDebug } from "@/state/debug";
import { runComposer, type PipelineHooks } from "./composer";
import { startImproviser } from "./improviser";

if (existsSync(".env.local")) loadEnvFile(".env.local");

const MODELS = (process.env.EVAL_MODELS ?? "anthropic/claude-haiku-4.5").split(",").map((s) => s.trim()).filter(Boolean);
const MODES = (process.env.EVAL_MODES ?? "composer,improviser").split(",");
const STYLES = (process.env.EVAL_STYLES ?? "swing").split(",") as StyleId[];
const BARS = Number(process.env.EVAL_BARS ?? 16);
const OUT = process.env.EVAL_OUT ?? "";
// the director (composer, improviser's leader) on its own model; players on the model under test
const DIRECTOR = process.env.EVAL_DIRECTOR ?? "";
const STANDARD = process.env.EVAL_STANDARD ?? null;
const SEEDS = (process.env.EVAL_SEEDS ?? process.env.EVAL_SEED ?? "11").split(",").map(Number);

// Rough list prices, $ per million tokens (input, output), for the spend estimate only.
const PRICE: Record<string, [number, number]> = {
  "anthropic/claude-haiku-4.5": [1, 5],
  "anthropic/claude-sonnet-4.6": [3, 15],
  "anthropic/claude-sonnet-5.5": [3, 15],
  "anthropic/claude-opus-5.5": [5, 25],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "google/gemini-3.8-flash": [0.5, 3],
  "openai/gpt-5.4-mini": [0.25, 2],
  "openai/gpt-5.6-luna": [0.25, 2],
};

// Every /api/llm request goes straight into the route handler, which picks up the server key.
// Anything else (the gateway provider's own requests) goes out on the real fetch.
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
  if (url !== "/api/llm") return realFetch(url, init);
  const body = JSON.parse(String(init?.body ?? "{}"));
  delete body.key;
  return POST(new Request("http://local/api/llm", { method: "POST", body: JSON.stringify(body), signal: init?.signal ?? undefined }));
});

const band: Member[] = defaultMembers();
const rows: Record<string, unknown>[] = [];

function hooks(runId: string): PipelineHooks {
  useDebug.getState().startRun(runId, runId);
  return { runId, apiKey: "", signal: new AbortController().signal, onStatus: () => {}, onChat: () => {}, onScore: () => {} };
}

/** Repairs bucketed by what went wrong, so a model's habits show up as counts. */
function bucket(repair: string): string {
  const r = repair.toLowerCase();
  if (r.includes("structured output unavailable")) return "no-structured";
  if (r.includes("played as written")) return "written-out";
  if (r.includes("json")) return "json";
  // bar lengths, by how they were fixed: a beat group or a recount keeps the model's rhythm, a squeeze or pad doesn't
  if (r.includes("gap kept inside its beat")) return "len:beat-fit";
  if (r.includes("looped to the barline")) return "len:looped";
  if (r.includes("squeezed")) return "len:squeezed";
  if (r.includes("padded")) return "len:padded";
  if (r.includes("still doesn't add up")) return "len:recount-miss";
  if (r.includes("add up") || r.includes("beats") || r.includes("overflow") || r.includes("short")) return "len:other";
  if (r.includes("range") || r.includes("octave")) return "range";
  if (r.includes("missing")) return "missing";
  if (r.includes("outside the") || r.includes("frame")) return "frame";
  if (r.includes("unknown") || r.includes("directive") || r.includes("couldn't")) return "directive";
  return "other";
}

/**
 * How well the bass and comping parts count their bars: of the accompanying bars a model wrote out
 * as notes, how many came in short (looped, padded, kept inside a beat), at half or a quarter of the
 * bar (repeated), or long (squeezed). Solo bars don't count; this is about grooves.
 */
function grooveLengths(score: Score | null, calls: { agent: string; repairs: string[] }[]) {
  const counts = { written: 0, short: 0, half: 0, long: 0 };
  if (!score) return counts;
  const accompanying = (m: Member, bar: number) => ["bass", "chordal"].includes(INSTRUMENTS[m.instrument].fn) && !isFeaturedRole(score.plan[bar]?.roles?.[m.id]);
  for (const bp of score.plan)
    for (const m of band) {
      const d = bp.directives?.[m.id] ?? "";
      if (d && !d.startsWith("@") && accompanying(m, bp.index)) counts.written++;
    }
  for (const c of calls)
    for (const r of c.repairs) {
      const bar = /\bbar (\d+)/.exec(r);
      const m = band.find((x) => x.id === c.agent) ?? band.find((x) => new RegExp(`\\b${x.name}\\b`).test(r));
      if (!bar || !m || !accompanying(m, +bar[1] - 1)) continue;
      if (/looped to the barline|padded with rest|inside its beat/.test(r)) counts.short++;
      else if (/repeated to fill the bar/.test(r)) counts.half++;
      else if (/squeezed to fit/.test(r)) counts.long++;
    }
  return counts;
}

function measure(model: string, mode: string, style: StyleId, runId: string, score: Score | null, err: string | null, ms: number) {
  const { calls, runs } = useDebug.getState();
  const mine = calls.filter((c) => c.runId === runId);
  const run = runs.find((r) => r.id === runId);
  const tokIn = mine.reduce((a, c) => a + (c.usage?.inputTokens ?? 0), 0);
  const tokOut = mine.reduce((a, c) => a + (c.usage?.outputTokens ?? 0), 0);
  // each call at its own model's price: a director and its players can differ
  const usd = mine.reduce((a, c) => {
    const [pi, po] = PRICE[c.model] ?? [3, 15];
    return a + ((c.usage?.inputTokens ?? 0) * pi + (c.usage?.outputTokens ?? 0) * po) / 1e6;
  }, 0);
  const repairs: Record<string, number> = {};
  for (const c of mine) for (const r of c.repairs) repairs[bucket(r)] = (repairs[bucket(r)] ?? 0) + 1;
  const issues: Record<string, number> = {};
  for (const i of run?.issues ?? []) {
    const k = i.detail.includes("clash") ? "clashed" : i.detail.startsWith("ensemble") ? "ensemble" : i.detail.split(/[:(]/)[0].slice(0, 30);
    issues[k] = (issues[k] ?? 0) + 1;
  }
  // how much of the chart the models actually wrote (vs the local plan's defaults)
  let written = 0;
  let cells = 0;
  if (score) {
    for (const bp of score.plan)
      for (const m of band) {
        cells++;
        const d = bp.directives?.[m.id] ?? "";
        if (d && !d.startsWith("@")) written++;
      }
  }
  // where the talk lands: lines per phrase, and the share said in the second half
  const P = score?.settings.phraseBars || 4;
  const jamLines = (score?.chat ?? []).filter((c) => c.phase === "jam" && c.bar !== undefined);
  const perPhrase = score ? Array.from({ length: Math.ceil(score.frame.bars / P) }, (_, i) => jamLines.filter((c) => Math.floor(c.bar! / P) === i).length) : [];
  const late = score ? jamLines.filter((c) => c.bar! >= score.frame.bars / 2).length : 0;
  const row = {
    model,
    mode,
    style,
    ok: !!score,
    err,
    sec: Math.round(ms / 100) / 10,
    calls: mine.length,
    failed: mine.filter((c) => c.status === "error").length,
    structured: `${mine.filter((c) => c.structured).length}/${mine.filter((c) => c.status === "ok").length}`,
    tokIn,
    tokOut,
    usd: Math.round(usd * 1000) / 1000,
    director: DIRECTOR || undefined,
    written: `${written}/${cells}`,
    recounts: mine.filter((c) => c.label.startsWith("recount")).length,
    grooves: grooveLengths(score, mine),
    talk: mode === "improviser" ? { perPhrase: perPhrase.join(" "), late: `${late}/${jamLines.length}` } : undefined,
    repairs,
    issues,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  for (const c of mine) {
    if (c.repairs.length || c.status === "error") {
      console.log(`  · ${c.label} [${c.status}${c.error ? `: ${c.error.slice(0, 160)}` : ""}] ${c.repairs.slice(0, 6).join(" | ").slice(0, 600)}`);
    }
  }
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${runId}.json`, JSON.stringify({ row, calls: mine.map((c) => ({ ...c, system: undefined })), issues: run?.issues, notes: score?.notes, chat: score?.chat.map((c) => `${c.phase}${c.bar !== undefined ? `@${c.bar + 1}` : ""} ${c.from}${c.to ? `→${c.to}` : ""}: ${c.text}`) }, null, 1));
  }
}

describe("gateway eval", () => {
  for (const model of MODELS)
    for (const style of STYLES)
      for (const mode of MODES)
        for (const seed of SEEDS) {
          it(`${mode} · ${style} · ${model} · seed ${seed}`, { timeout: 600_000 }, async () => {
            const runId = `${mode}-${STANDARD ?? style}-${DIRECTOR ? `${DIRECTOR.replace(/\W+/g, "_")}+` : ""}${model.replace(/\W+/g, "_")}-s${seed}`;
            const settings = {
              ...defaultSettings(band),
              mode: mode as "composer" | "improviser",
              style,
              bars: BARS,
              bestOf: 2,
              soloists: ["bear"],
              directorModel: DIRECTOR || model,
              standard: STANDARD,
              playerModel: model,
              seed,
            };
            const t0 = performance.now();
            let score: Score | null = null;
            let err: string | null = null;
            try {
              score = mode === "composer" ? await runComposer(settings, band, hooks(runId)) : await startImproviser(settings, band, hooks(runId)).promise;
            } catch (e) {
              err = (e as Error).message;
            }
            measure(model, mode, style, runId, score, err, performance.now() - t0);
          });
        }
  afterAll(() => {
    const usd = rows.reduce((a, r) => a + (r.usd as number), 0);
    console.log(`\nestimated spend this run: $${usd.toFixed(3)}`);
    const g = { written: 0, short: 0, half: 0, long: 0 };
    for (const r of rows) for (const k of Object.keys(g) as (keyof typeof g)[]) g[k] += (r.grooves as typeof g)[k];
    console.log(`accompanying bars written out: ${g.written}; short ${g.short}, half/quarter ${g.half}, long ${g.long}`);
  });
});
