"use client";

import { useEffect, useMemo, useState } from "react";
import { troopAudio, type LoadState, type PlaybackStats } from "@/audio/engine";
import { callCost, fmtCost } from "@/ai/models";
import { INSTRUMENTS } from "@/music/instruments";
import { useDebug, type LlmCall } from "@/state/debug";
import { useTroop } from "@/state/store";

export function fmtMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

const TABS = ["Pipeline", "Plan", "Chart", "Audio", "Issues"] as const;
type Tab = (typeof TABS)[number];

function Pre({ children, max = "18rem" }: { children: string; max?: string }) {
  return (
    <pre className="overflow-auto whitespace-pre-wrap break-words rounded-xs bg-(--neutral-9-transparent) p-xs font-data text-xxs" style={{ maxHeight: max }}>
      {children}
    </pre>
  );
}

function CallRow({ c }: { c: LlmCall }) {
  const [open, setOpen] = useState(false);
  const tok = c.usage ? `${c.usage.inputTokens ?? "?"}→${c.usage.outputTokens ?? "?"}` : "";
  return (
    <>
      <tr className="rule-top cursor-pointer hover:bg-(--neutral-9-transparent)" onClick={() => setOpen((o) => !o)}>
        <td className="py-xxs pr-xs">{open ? "▾" : "▸"}</td>
        <td className="pr-xs">{fmtMs(c.startedAt)}</td>
        <td className="pr-xs font-heavy">{c.agent}</td>
        <td className="pr-xs">{c.label}</td>
        <td className="pr-xs text-ink-soft">{c.model.split("/")[1]}</td>
        <td className="pr-xs">{c.status === "pending" ? "…" : fmtMs(c.ms)}</td>
        <td className="pr-xs text-ink-soft">{fmtMs(c.serverMs)}</td>
        <td className="pr-xs text-ink-soft">{tok}</td>
        <td className="pr-xs text-ink-soft" title={c.params ? JSON.stringify(c.params) : undefined}>
          {c.status === "ok" ? (c.structured ? "schema" : "text") : ""}
        </td>
        <td>
          {/* the status reads in ink; the coloured mark is a glance aid (warning yellow is too light for text) */}
          <span aria-hidden className={c.status === "error" ? "text-(--error)" : c.status === "pending" ? "text-ink-soft" : c.repairs.length ? "text-(--warning)" : "text-(--success)"}>
            ●{" "}
          </span>
          {c.status === "error" ? c.error : c.status === "ok" ? (c.repairs.length ? `${c.repairs.length} repairs` : "ok") : "pending"}
          {c.attempt > 1 ? ` (try ${c.attempt})` : ""}
        </td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={9} className="pb-s">
            {c.params && (
              <div className="mb-xxs text-ink-soft">
                sent: {c.params.reasoning ? `reasoning ${c.params.reasoning}` : "provider default reasoning"}
                {c.params.temperature !== undefined ? `, temperature ${c.params.temperature}` : ", no temperature"}
              </div>
            )}
            {c.repairs.length > 0 && (
              <div className="mb-xs">
                <div className="font-heavy">Validation & repairs</div>
                <ul className="list-disc pl-l">
                  {c.repairs.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-xs lg:grid-cols-2">
              <div>
                <div className="font-heavy">System</div>
                <Pre max="10rem">{c.system}</Pre>
                <div className="mt-xxs font-heavy">Prompt</div>
                <Pre>{c.prompt}</Pre>
              </div>
              <div>
                <div className="font-heavy">Raw reply</div>
                <Pre>{c.text ?? c.error ?? "(waiting)"}</Pre>
                {c.parsed !== undefined && (
                  <>
                    <div className="mt-xxs font-heavy">Parsed</div>
                    <Pre max="12rem">{JSON.stringify(c.parsed, null, 1)}</Pre>
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PipelineTab() {
  const runs = useDebug((s) => s.runs);
  const calls = useDebug((s) => s.calls);
  const [sel, setSel] = useState<string | null>(null);
  const run = runs.find((r) => r.id === sel) ?? runs[0];
  const runCalls = calls.filter((c) => c.runId === run?.id);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (run?.status !== "running") return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [run?.status]);
  if (!run) return <p>No runs yet.</p>;
  const elapsed = (run.endedAt ?? Math.max(now, run.t0)) - run.t0;
  const tokens = runCalls.reduce((s, c) => s + (c.usage?.inputTokens ?? 0) + (c.usage?.outputTokens ?? 0), 0);
  const costs = runCalls.map((c) => callCost(c.model, c.usage)).filter((x): x is number => x !== null);
  const cost = costs.length && tokens > 0 ? costs.reduce((a, b) => a + b, 0) : null;
  return (
    <div>
      <div className="mb-xs flex flex-wrap items-center gap-xs">
        <select className="sketch-select" value={run.id} onChange={(e) => setSel(e.target.value)} aria-label="Run">
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.startedAt).toLocaleTimeString()} · {r.mode} · {r.status}
            </option>
          ))}
        </select>
        <span>
          <b>{run.status}</b> · {fmtMs(elapsed)} wall · {runCalls.length} model calls · {tokens.toLocaleString()} tokens
          {cost !== null && <span title="At list prices; your provider's bill is the real figure"> · ≈ {fmtCost(cost)}</span>}
        </span>
      </div>
      {Object.keys(run.timings).length > 0 && (
        <div className="mb-xs flex flex-wrap gap-x-m gap-y-xxs">
          {Object.entries(run.timings).map(([k, v]) => (
            <span key={k}>
              {k}: <b>{fmtMs(v)}</b>
            </span>
          ))}
        </div>
      )}
      {run.steps.length > 0 && (
        <ol className="mb-s max-h-40 overflow-auto">
          {run.steps.map((s, i) => (
            <li key={i}>
              <span className="inline-block w-20 text-ink-soft">{fmtMs(s.t)}</span>
              {s.text}
            </li>
          ))}
        </ol>
      )}
      {runCalls.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-ink-soft">
                <th />
                <th>start</th>
                <th>who</th>
                <th>what</th>
                <th>model</th>
                <th>wall</th>
                <th>model time</th>
                <th>tokens in→out</th>
                <th>output</th>
                <th>result</th>
              </tr>
            </thead>
            <tbody>
              {runCalls.map((c) => (
                <CallRow key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanTab() {
  const score = useTroop((s) => s.current);
  const [json, setJson] = useState(false);
  if (!score) return <p>No chart.</p>;
  return (
    <div>
      <label className="mb-xs flex items-center gap-xs">
        <input type="checkbox" className="sketch-check" checked={json} onChange={(e) => setJson(e.target.checked)} /> show plan JSON
      </label>
      {json ? (
        <Pre max="30rem">{JSON.stringify({ motif: score.motif, plan: score.plan }, null, 1)}</Pre>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-left">
            <thead>
              <tr className="text-ink-soft">
                <th className="pr-xs">bar</th>
                <th className="pr-xs">chords</th>
                <th className="pr-xs">section</th>
                <th className="pr-xs">dyn / texture</th>
                {score.members.map((m) => (
                  <th key={m.id} className="pr-s">
                    {m.name} <span className="font-regular">({INSTRUMENTS[m.instrument].name})</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {score.plan.map((bp) => (
                <tr key={bp.index} className="rule-top align-top">
                  <td className="pr-xs">{bp.index + 1}</td>
                  <td className="whitespace-nowrap pr-xs">{bp.chords.map((c) => c.symbol).join(" ")}</td>
                  <td className="whitespace-nowrap pr-xs">{bp.section}</td>
                  <td className="whitespace-nowrap pr-xs">
                    {bp.dynamic} / {bp.texture}
                  </td>
                  {score.members.map((m) => (
                    <td key={m.id} className="max-w-[16rem] pr-s font-data text-xxs">
                      <span className="text-ink-soft">{bp.roles[m.id]}</span> {bp.directives?.[m.id]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChartTab() {
  const score = useTroop((s) => s.current);
  if (!score) return <p>No chart.</p>;
  const { frame, motif } = score;
  return (
    <div className="grid gap-s lg:grid-cols-2">
      <div>
        <div className="font-heavy">Locked frame</div>
        <p>
          {frame.bars} bars · {frame.meter.beats}/4 · {frame.key.tonic} {frame.key.mode} · {frame.tempo} bpm · swing {score.swing.toFixed(2)} · seed {score.settings.seed}
          {frame.standard ? ` · standard: ${frame.standard}` : ""}
        </p>
        <ul className="mt-xxs">
          {frame.sections.map((s) => (
            <li key={s.start}>
              bars {s.start + 1}–{s.start + s.length}: {s.name} <span className="text-ink-soft">({s.kind})</span>
            </li>
          ))}
        </ul>
        <div className="mt-xs font-heavy">Motif</div>
        <p className="font-data text-xs">{motif.text}</p>
        {motif.description && <p className="text-ink-soft">{motif.description}</p>}
        <div className="mt-xs font-heavy">Notes</div>
        <ul className="list-disc pl-l">
          {score.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </div>
      <div>
        {score.critic && (
          <>
            <div className="font-heavy">Judge (best of {score.critic.scores.length})</div>
            <table className="text-left">
              <thead>
                <tr className="text-ink-soft">
                  <th className="pr-xs">#</th>
                  <th className="pr-xs">distinct</th>
                  <th className="pr-xs">coherent</th>
                  <th className="pr-xs">score</th>
                  <th>note</th>
                </tr>
              </thead>
              <tbody>
                {score.critic.scores.map((s) => (
                  <tr key={s.candidate} className={s.candidate === score.critic!.chosen ? "font-heavy" : ""}>
                    <td className="pr-xs">{s.candidate}</td>
                    <td className="pr-xs">{s.distinctiveness}</td>
                    <td className="pr-xs">{s.coherence}</td>
                    <td className="pr-xs">{s.score}</td>
                    <td>{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-xxs">{score.critic.summary}</p>
          </>
        )}
        <div className="mt-xs font-heavy">Notes per player</div>
        <ul>
          {score.members.map((m) => (
            <li key={m.id}>
              {m.name}: {score.parts[m.id]?.length ?? 0} notes
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AudioTab({ sheetStats }: { sheetStats: { rows: number; renderMs: number; expandMs: number } | null }) {
  const [loads, setLoads] = useState<LoadState[]>([]);
  const [stats, setStats] = useState<PlaybackStats | null>(null);
  useEffect(() => troopAudio.onLoad(setLoads), []);
  useEffect(() => {
    const t = setInterval(() => setStats(troopAudio.getStats()), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid gap-s lg:grid-cols-2">
      <div>
        <div className="font-heavy">Instruments</div>
        <ul>
          {loads.map((l) => (
            <li key={l.memberId}>
              {l.memberId}: {l.instrument} — {l.pack} — {l.ready ? "ready" : l.error ? (
                <span>
                  <span aria-hidden className="text-(--error)">
                    ✗{" "}
                  </span>
                  {l.error}
                </span>
              ) : `${l.loaded}/${l.total}`}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="font-heavy">Playback</div>
        {stats && (
          <p>
            scheduled {stats.scheduled} · late {stats.late} · dropped {stats.dropped}
            {stats.failedInstruments.length ? ` · failed: ${stats.failedInstruments.join(", ")}` : ""}
          </p>
        )}
        <div className="mt-xs font-heavy">Sheet render</div>
        {sheetStats ? (
          <p>
            {sheetStats.rows} rows · VexFlow {fmtMs(sheetStats.renderMs)} · note expansion {fmtMs(sheetStats.expandMs)}
          </p>
        ) : (
          <p className="text-ink-soft">—</p>
        )}
      </div>
    </div>
  );
}

function IssuesTab() {
  const runs = useDebug((s) => s.runs);
  const score = useTroop((s) => s.current);
  const run = runs.find((r) => r.status !== "running");
  const issues = run?.issues ?? [];
  const nameOf = (id: string) => score?.members.find((m) => m.id === id)?.name ?? id;
  if (!issues.length) return <p>The engine realized every bar without complaints.</p>;
  return (
    <ul className="max-h-80 overflow-auto">
      {issues.map((i, k) => (
        <li key={k}>
          bar {i.bar + 1} · {nameOf(i.member)}: {i.detail}
        </li>
      ))}
    </ul>
  );
}

export function DebugPanel({ sheetStats }: { sheetStats: { rows: number; renderMs: number; expandMs: number } | null }) {
  const [tab, setTab] = useState<Tab>("Pipeline");
  const runs = useDebug((s) => s.runs);
  const body = useMemo(() => {
    switch (tab) {
      case "Pipeline":
        return <PipelineTab />;
      case "Plan":
        return <PlanTab />;
      case "Chart":
        return <ChartTab />;
      case "Audio":
        return <AudioTab sheetStats={sheetStats} />;
      case "Issues":
        return <IssuesTab />;
    }
  }, [tab, sheetStats]);
  return (
    <section className="debug-panel mt-m p-s text-s" aria-label="Debug">
      <div className="mb-xs flex flex-wrap items-center gap-xxs">
        <h2 className="type-label mr-xs">Under the hood</h2>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            data-selected={tab === t}
            className="pick px-xs py-xxs"
          >
            {t}
            {t === "Pipeline" && runs[0]?.status === "running" ? " •" : ""}
          </button>
        ))}
      </div>
      {body}
    </section>
  );
}
