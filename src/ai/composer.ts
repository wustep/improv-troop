import { buildFrame, frameSummary } from "@/music/form";
import { ritFor } from "@/music/ending";
import { INSTRUMENTS } from "@/music/instruments";
import { motifForFrame, newScoreId } from "@/music/local";
import { planLocal } from "@/music/planner";
import { isFeaturedRole, realize } from "@/music/realize";
import { makeRng } from "@/music/rng";
import { STYLES, swingAt } from "@/music/styles";
import type { BarPlan, ChatMessage, CriticScore, Member, Motif, Score, TroopSettings } from "@/music/types";
import { useDebug } from "@/state/debug";
import { textureFeatures } from "./features";
import { asRecord, asString, extractJson } from "./json";
import { callLLM, noteRepair, setParsed } from "./llm";
import { mergePlan, validateBarText, validateMotif } from "./merge";
import { barsSchema, criticSchema, planSchema } from "./schemas";
import {
  arcNote,
  bandBlock,
  chartBlock,
  CRITIC_SYSTEM,
  DIRECTOR_SYSTEM,
  GRAMMAR,
  harmonyBlock,
  motifBlock,
  NOTES_ONLY,
  personaSystem,
  sketchBlock,
  styleBlock,
} from "./prompts";

export interface PipelineHooks {
  runId: string;
  apiKey: string;
  signal: AbortSignal;
  onStatus(text: string): void;
  onChat(msg: ChatMessage): void;
  onScore(score: Score, final: boolean): void;
}

interface Candidate {
  index: number;
  concept: string;
  motif: Motif;
  plan: BarPlan[];
  repairs: string[];
  features?: string;
}

let msgSeq = 0;
export function chatMsg(from: string, text: string, phase: ChatMessage["phase"], bar?: number, to?: string): ChatMessage {
  return { id: `m${Date.now().toString(36)}${++msgSeq}`, from, text: text.slice(0, 220), phase, bar, to };
}

function directorPrompt(settings: TroopSettings, members: Member[], frameText: string, frame: ReturnType<typeof buildFrame>, localMotif: Motif): string {
  const leader = members.find((m) => m.id === frame.leaderId);
  const ids = members.map((m) => `"${m.id}"`).join(", ");
  return [
    styleBlock(frame),
    "",
    chartBlock(frame, members),
    "",
    bandBlock(members, frame),
    "",
    GRAMMAR,
    "",
    `TASK — write the chart for all ${frame.bars} bars as JSON:`,
    `{
  "concept": "one sentence: the idea of this take",
  "motif": "the shared cell for ${leader?.name ?? "the leader"} in compact notes — 1 bar (or 2 bars separated by |), in their sweet spot, rhythmically characteristic of the style",
  "motifIdea": "a few words",
  "bars": [
    { "bars": "1-2", "texture": "groove", "dynamic": "mf", "cue": "short note", "parts": { ${members.map((m) => `"${m.id}": "..."`).join(", ")} } },
    { "bars": "3", ... }
  ]
}`,
    `Rules:
- Cover bars 1-${frame.bars} exactly once, in order. Use ranges ("5-8") when parts repeat; single bars ("7") for special bars. Never add or remove bars.
- Every entry's "parts" has every player: ${ids}.
- The leader states the motif in the head (@motif, @motif up 2, @motif bar2 ...). A soloist opens with a transform of the motif (@motif invert / displace 0.5 / frag 3 / seq -1 ...) then develops it (@line, written notes). Everyone else comps in the style's texture — that texture is what makes the style distinct.
- Shape dynamics and texture across the form (e.g. sparse → build → peak). Use a drum @fill or a stop-time @hits where a phrase turns.
- The final bar is @end for everyone.
- Example motif in this style (don't copy): ${localMotif.text}`,
  ].join("\n");
}

function partsPrompt(member: Member, bars: number[], plan: BarPlan[], frame: ReturnType<typeof buildFrame>, members: Member[], motif: Motif, sketch: string): string {
  const inst = INSTRUMENTS[member.instrument];
  const others = members.filter((m) => m.id !== member.id);
  const rows = bars.map((b) => {
    const bp = plan[b];
    const role = bp.roles[member.id];
    const backing = others.map((m) => `${m.name} ${bp.directives?.[m.id] ?? "@rest"}`).join(", ");
    const arc = arcNote(frame, b, role);
    return `  bar ${b + 1}: ${frame.chords[b].map((c) => c.symbol).join(" ")} · ${bp.section} · ${role}${arc ? ` (${arc})` : ""} · ${bp.dynamic}/${bp.texture} · director: ${bp.directives?.[member.id] ?? ""}${bp.cue ? ` ("${bp.cue}")` : ""}\n      under you: ${backing}`;
  });
  return [
    styleBlock(frame),
    "",
    chartBlock(frame, members),
    "",
    motifBlock(motif),
    "",
    `YOUR FEATURED BARS (${inst.name}):`,
    ...rows,
    "",
    harmonyBlock(frame, plan, bars),
    "",
    sketch,
    "",
    NOTES_ONLY,
    inst.breath ? `You play a wind instrument: leave short rests to breathe at least every ${inst.breath} beats.` : "",
    `Write every one of these bars note by note. Solos are transforms of the motif: start from it (inverted, sequenced, displaced, fragmented), develop it, build toward the end of your feature. Think in phrases that cross bar lines: a pickup, a direction (climb, fall, arch), a landing on a chord tone on a strong beat, a breath. A head restates the motif recognizably. Keep inside your range, on the beat grid, and in the style's texture.`,
    `Reply: {"bars": {${bars.map((b) => `"${b + 1}": "..."`).join(", ")}}}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function criticPrompt(frame: ReturnType<typeof buildFrame>, cands: Candidate[]): string {
  const style = STYLES[frame.style];
  const blocks = cands.map((c) =>
    [
      `CANDIDATE ${c.index}: "${c.concept}"`,
      `  motif: ${c.motif.text}`,
      c.features ?? "",
    ].join("\n"),
  );
  return [
    `Requested style: ${style.name}. Texture priors: ${style.texture}`,
    "",
    ...blocks,
    "",
    `Reply: {"scores": [{"candidate": 1, "distinctiveness": 0-10, "coherence": 0-10, "note": "<= 15 words"}], "best": <candidate number>, "summary": "<= 25 words on why"}`,
  ].join("\n");
}

/** Composer: a director writes the chart (best-of-N with a judge), then featured parts. */
export async function runComposer(settings: TroopSettings, members: Member[], hooks: PipelineHooks): Promise<Score> {
  const { runId, apiKey, signal } = hooks;
  const dbg = useDebug.getState();
  const tStart = performance.now();
  const step = (s: string) => {
    dbg.step(runId, s);
    hooks.onStatus(s);
  };

  // Level 0: locked frame + a local baseline for every fallback.
  const frame = buildFrame(settings, members);
  const rng = makeRng(settings.seed);
  const localMotif = motifForFrame(frame, members, rng.fork("motif"));
  const basePlan = planLocal(frame, members, localMotif, rng.fork("plan"));
  dbg.step(runId, `frame locked: ${frameSummary(frame, members).split("\n")[0]}`);

  // Level 1: director plans (best-of-N).
  const n = Math.max(1, Math.min(4, settings.bestOf));
  step(n > 1 ? `The director is sketching ${n} charts…` : "The director is sketching the chart…");
  const prompt = directorPrompt(settings, members, frameSummary(frame, members), frame, localMotif);
  const leader = members.find((m) => m.id === frame.leaderId);
  const t1 = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: n }, (_, i) =>
      callLLM({
        runId,
        apiKey,
        signal,
        label: n > 1 ? `plan ${i + 1}/${n}` : "plan",
        agent: "director",
        model: settings.directorModel,
        system: DIRECTOR_SYSTEM,
        prompt,
        temperature: n > 1 ? 0.75 + i * 0.1 : 0.8,
        maxOutputTokens: 7000,
        reasoning: "low",
        schema: planSchema(members.map((m) => m.id)),
        schemaName: "chart",
      }),
    ),
  );
  dbg.timing(runId, "plans", performance.now() - t1);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const cands: Candidate[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const { text, call } = r.value;
    const repairs: string[] = [];
    const { value, error } = extractJson(text);
    if (error) repairs.push(error);
    const obj = asRecord(value);
    setParsed(call.id, obj);
    const motif = validateMotif(obj.motif, obj.motifIdea, frame, leader, repairs) ?? localMotif;
    const plan = mergePlan(basePlan, obj.bars, frame, members, repairs);
    repairs.forEach((x) => noteRepair(call.id, x));
    if (value) cands.push({ index: i + 1, concept: asString(obj.concept, 200) ?? "(no concept)", motif, plan, repairs });
  });
  if (!cands.length) {
    const firstErr = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error((firstErr?.reason as Error)?.message ?? "The director didn't return a usable chart.");
  }

  // Judge: score candidates on texture distinctiveness (computed features keep it honest).
  let chosen = cands[0];
  let critic: Score["critic"] | undefined;
  if (cands.length > 1) {
    step("Weighing the sketches…");
    for (const c of cands) {
      const r = realize({ frame, members, plan: c.plan, motif: c.motif, seed: settings.seed + c.index });
      c.features = textureFeatures(frame, members, c.plan, r.parts);
    }
    try {
      const t2 = performance.now();
      const { text, call } = await callLLM({
        runId,
        apiKey,
        signal,
        label: "judge",
        agent: "critic",
        model: settings.directorModel,
        system: CRITIC_SYSTEM,
        prompt: criticPrompt(frame, cands),
        temperature: 0.2,
        maxOutputTokens: 800,
        reasoning: "none",
        schema: criticSchema(),
        schemaName: "judgement",
      });
      dbg.timing(runId, "judge", performance.now() - t2);
      const { value } = extractJson(text);
      const obj = asRecord(value);
      setParsed(call.id, obj);
      const scores: CriticScore[] = (Array.isArray(obj.scores) ? obj.scores : []).map((s) => {
        const o = asRecord(s);
        const d = Number(o.distinctiveness) || 0;
        const co = Number(o.coherence) || 0;
        return { candidate: Number(o.candidate) || 0, distinctiveness: d, coherence: co, score: Math.round((d * 0.6 + co * 0.4) * 10) / 10, notes: asString(o.note, 120) ?? "" };
      });
      const best = Number(obj.best);
      const byScore = [...scores].sort((a, b) => b.score - a.score)[0];
      const pick = cands.find((c) => c.index === best) ?? cands.find((c) => c.index === byScore?.candidate) ?? cands[0];
      chosen = pick;
      critic = { scores, chosen: pick.index, summary: asString(obj.summary, 200) ?? "" };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      dbg.step(runId, `judge failed (${(e as Error).message}); keeping candidate ${chosen.index}`);
    }
  }

  // Level 2: featured players' bars written note by note.
  const plan = chosen.plan;
  const featured = new Map<string, number[]>();
  for (const bp of plan) {
    for (const m of members) {
      if (m.instrument === "drums") continue;
      // the tune coming back (@head) replays what was written for the head: nothing to write
      if (isFeaturedRole(bp.roles[m.id]) && bp.index !== frame.bars - 1 && !bp.directives?.[m.id]?.startsWith("@head")) {
        if (!featured.has(m.id)) featured.set(m.id, []);
        featured.get(m.id)!.push(bp.index);
      }
    }
  }
  if (featured.size) {
    step("Writing out the solos…");
    const draft = realize({ frame, members, plan, motif: chosen.motif, seed: settings.seed });
    const t3 = performance.now();
    await Promise.all(
      [...featured.entries()].map(async ([id, bars]) => {
        const m = members.find((x) => x.id === id)!;
        try {
          const { text, call } = await callLLM({
            runId,
            apiKey,
            signal,
            label: `parts: ${m.name}`,
            agent: "director",
            model: settings.directorModel,
            system: personaSystem(m, frame, "The director has handed you the chart; write your featured bars."),
            prompt: partsPrompt(m, bars, plan, frame, members, chosen.motif, sketchBlock(m, bars, draft.parts, frame)),
            temperature: 0.8,
            maxOutputTokens: 2500,
            reasoning: "none",
            schema: barsSchema(bars.map((b) => b + 1), false),
            schemaName: "bars",
          });
          const { value, error } = extractJson(text);
          if (error) noteRepair(call.id, error);
          const obj = asRecord(asRecord(value).bars);
          setParsed(call.id, obj);
          for (const b of bars) {
            const raw = asString(obj[String(b + 1)], 600);
            if (!raw) {
              noteRepair(call.id, `bar ${b + 1} missing; kept ${plan[b].directives?.[id]}`);
              continue;
            }
            const repairs: string[] = [];
            const clean = validateBarText(raw, m, frame.meter.beats, repairs, `bar ${b + 1}`);
            repairs.forEach((x) => noteRepair(call.id, x));
            if (clean && clean !== "@rest") plan[b].directives = { ...plan[b].directives, [id]: clean };
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          dbg.step(runId, `${m.name}'s parts failed (${(e as Error).message}); engine improvises those bars`);
        }
      }),
    );
    dbg.timing(runId, "parts", performance.now() - t3);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  // Realize.
  const res = realize({ frame, members, plan, motif: chosen.motif, seed: settings.seed });
  dbg.timing(runId, "realize", res.ms);
  dbg.timing(runId, "total", performance.now() - tStart);
  const chat: ChatMessage[] = [chatMsg("director", chosen.concept, "setup", 0)];
  for (const bp of plan) if (bp.cue && (bp.index === 0 || plan[bp.index - 1].cue !== bp.cue)) chat.push(chatMsg("director", bp.cue, "jam", bp.index));
  const style = STYLES[settings.style];
  const score: Score = {
    id: newScoreId(),
    title: `${style.name} · composed`,
    createdAt: Date.now(),
    settings,
    members,
    frame,
    plan,
    motif: chosen.motif,
    swing: swingAt(style, frame.tempo),
    rit: ritFor(frame),
    parts: res.parts,
    chat,
    engine: "ai",
    critic,
    notes: [
      `Director: ${settings.directorModel}`,
      ...(cands.length > 1 ? [`${cands.length} candidates judged; chose #${chosen.index}`] : []),
      ...chosen.repairs.slice(0, 20),
    ],
  };
  useDebug.getState().endRun(runId, "done", res.issues);
  return score;
}
