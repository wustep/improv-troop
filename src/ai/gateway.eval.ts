// Real-model evaluation: runs the composer and improviser pipelines against the Vercel AI
// Gateway and scores what comes back with the app's own validators. Not part of `pnpm test`.
//
//   EVAL_MODELS=anthropic/claude-haiku-4.5,google/gemini-2.5-flash pnpm eval:gateway
//
// The key comes from IMPROV_TROOP_SERVER_KEY in .env.local, read by the /api/llm route itself;
// this file never reads, prints, or forwards it.
import { loadEnvFile } from "node:process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, it, vi } from "vitest";
import { POST } from "@/app/api/llm/route";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings } from "@/music/local";
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
  if (r.includes("json")) return "json";
  if (r.includes("add up") || r.includes("beats") || r.includes("overflow") || r.includes("short")) return "bar-length";
  if (r.includes("range") || r.includes("octave")) return "range";
  if (r.includes("missing")) return "missing";
  if (r.includes("outside the") || r.includes("frame")) return "frame";
  if (r.includes("unknown") || r.includes("directive") || r.includes("couldn't")) return "directive";
  return "other";
}

function measure(model: string, mode: string, style: StyleId, runId: string, score: Score | null, err: string | null, ms: number) {
  const { calls, runs } = useDebug.getState();
  const mine = calls.filter((c) => c.runId === runId);
  const run = runs.find((r) => r.id === runId);
  const tokIn = mine.reduce((a, c) => a + (c.usage?.inputTokens ?? 0), 0);
  const tokOut = mine.reduce((a, c) => a + (c.usage?.outputTokens ?? 0), 0);
  const [pi, po] = PRICE[model] ?? [3, 15];
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
    usd: Math.round(((tokIn * pi + tokOut * po) / 1e6) * 1000) / 1000,
    written: `${written}/${cells}`,
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
    writeFileSync(`${OUT}/${runId}.json`, JSON.stringify({ row, calls: mine.map((c) => ({ ...c, system: undefined })), issues: run?.issues, notes: score?.notes }, null, 1));
  }
}

describe("gateway eval", () => {
  for (const model of MODELS)
    for (const style of STYLES)
      for (const mode of MODES) {
        it(`${mode} · ${style} · ${model}`, { timeout: 600_000 }, async () => {
          const runId = `${mode}-${STANDARD ?? style}-${DIRECTOR ? `${DIRECTOR.replace(/\W+/g, "_")}+` : ""}${model.replace(/\W+/g, "_")}`;
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
            seed: 11,
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
  });
});
