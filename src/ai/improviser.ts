import { newMemory, type PlayerMemory } from "@/music/context";
import { buildFrame, sectionAt } from "@/music/form";
import { INSTRUMENTS } from "@/music/instruments";
import { motifForFrame, newScoreId } from "@/music/local";
import { planLocal } from "@/music/planner";
import { isFeaturedRole, realize } from "@/music/realize";
import { makeRng } from "@/music/rng";
import { STYLES } from "@/music/styles";
import type { BarPlan, ChatMessage, Frame, Member, Motif, NoteEvent, Score, TroopSettings } from "@/music/types";
import { useDebug } from "@/state/debug";
import { chatMsg, type PipelineHooks } from "./composer";
import { asRecord, asString, extractJson, parseBarRange } from "./json";
import { callLLM, noteRepair, setParsed } from "./llm";
import { asDynamic, asTexture, enforceSlots, resolveMember, validateBarText, validateMotif } from "./merge";
import {
  bandBlock,
  chartBlock,
  chatBlock,
  GRAMMAR,
  motifBlock,
  NOTES_ONLY,
  personaSystem,
  playedBlock,
  styleBlock,
} from "./prompts";

export interface ImprovController {
  promise: Promise<Score>;
  /** Make sure every bar up to `bar` is playable; unready phrases get the band's autopilot. */
  ensureReady(bar: number): boolean;
  /** Number of bars realized so far (from the top). */
  readyBars(): number;
}

type Stage = "none" | "featured" | "done";

function describeBars(bars: number[], frame: Frame, plan: BarPlan[], memberId: string): string {
  return bars
    .map((b) => {
      const bp = plan[b];
      return `  bar ${b + 1}: ${frame.chords[b].map((c) => c.symbol).join(" ")} · ${bp.section} · you: ${bp.roles[memberId]} (${bp.directives?.[memberId] ?? "@rest"}) · ${bp.dynamic}/${bp.texture}`;
    })
    .join("\n");
}

const REPLY_SHAPE = (bars: number[]) => `{"bars": {${bars.map((b) => `"${b + 1}": "..."`).join(", ")}}, "say": "optional: a short line to the band or a bandmate (<= 12 words), or \\"\\""}`;

export function startImproviser(settings: TroopSettings, members: Member[], hooks: PipelineHooks): ImprovController {
  const { runId, apiKey, signal } = hooks;
  const dbg = useDebug.getState();
  const frame = buildFrame(settings, members);
  const rng = makeRng(settings.seed);
  let motif: Motif = motifForFrame(frame, members, rng.fork("motif"));
  let plan: BarPlan[] = planLocal(frame, members, motif, rng.fork("plan"));
  const P = Math.max(2, settings.phraseBars || 4);
  const phrases: number[][] = [];
  for (let s = 0; s < frame.bars; s += P) phrases.push(Array.from({ length: Math.min(P, frame.bars - s) }, (_, i) => s + i));
  const stage: Stage[] = phrases.map(() => "none");
  const autopilot = new Set<number>();
  const parts: Record<string, NoteEvent[]> = Object.fromEntries(members.map((m) => [m.id, []]));
  const memories = new Map<string, PlayerMemory>(members.map((m) => [m.id, newMemory()]));
  const featuredByBar = new Map<number, NoteEvent[]>();
  const chat: ChatMessage[] = [];
  const issues: ReturnType<typeof realize>["issues"] = [];
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const leader = members.find((m) => m.id === frame.leaderId) ?? members[0];
  const style = STYLES[settings.style];
  const scoreId = newScoreId();
  let started = false;

  const say = (msg: ChatMessage) => {
    chat.push(msg);
    hooks.onChat(msg);
  };
  const step = (s: string) => {
    dbg.step(runId, s);
    hooks.onStatus(s);
  };

  const snapshot = (final: boolean): Score => ({
    id: scoreId,
    title: `${style.name} · improvised`,
    createdAt: Date.now(),
    settings,
    members,
    frame,
    plan,
    motif,
    swing: style.swing,
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, [...v].sort((a, b) => a.start - b.start)])),
    chat: [...chat],
    engine: "ai",
    notes: [
      `Leader ${nameOf(leader.id)} on ${settings.directorModel}; band on ${settings.playerModel}.`,
      ...(autopilot.size ? [`Autopilot (band vamped while thinking) on phrases ${[...autopilot].map((p) => p + 1).join(", ")}.`] : []),
      ...(final ? [] : ["(still jamming…)"]),
    ],
  });

  const realizeStage = (pi: number, which: "featured" | "rest") => {
    const bars = phrases[pi];
    const r = realize({
      frame,
      members,
      plan,
      motif,
      seed: settings.seed,
      bars,
      memories,
      priorFeatured: featuredByBar,
      filter: (id, bar) => {
        const f = isFeaturedRole(plan[bar]?.roles[id]);
        return which === "featured" ? f : !f;
      },
    });
    for (const [id, notes] of Object.entries(r.parts)) parts[id].push(...notes);
    issues.push(...r.issues);
  };

  const readyBars = () => {
    let n = 0;
    for (let i = 0; i < phrases.length && stage[i] === "done"; i++) n += phrases[i].length;
    return n;
  };

  const ensureReady = (bar: number) => {
    if (!started) return false;
    let filled = false;
    const upto = Math.min(phrases.length - 1, Math.floor(bar / P));
    for (let pi = 0; pi <= upto; pi++) {
      if (stage[pi] === "done") continue;
      if (stage[pi] === "none") realizeStage(pi, "featured");
      realizeStage(pi, "rest");
      stage[pi] = "done";
      autopilot.add(pi);
      filled = true;
      dbg.step(runId, `phrase ${pi + 1} (bars ${phrases[pi][0] + 1}-${phrases[pi].at(-1)! + 1}) went on autopilot — the band vamped while thinking`);
    }
    if (filled) hooks.onScore(snapshot(false), false);
    return filled;
  };

  const promise = (async () => {
    const tStart = performance.now();
    // ── Count-off: the leader sets the motif, the arc, and asks ──
    step(`${leader.name} is calling the tune…`);
    const others = members.filter((m) => m.id !== leader.id);
    const asks: Record<string, string> = {};
    try {
      const { text, call } = await callLLM({
        runId,
        apiKey,
        signal,
        label: "count-off",
        agent: leader.id,
        model: settings.directorModel,
        system: personaSystem(leader, frame, "You lead this tune. Before counting off you tell the band your idea, like a real bandleader: short, warm, specific, naming people."),
        prompt: [
          styleBlock(frame),
          "",
          chartBlock(frame, members),
          "",
          bandBlock(members, frame),
          "",
          NOTES_ONLY,
          "",
          `Before you count off, give the band the plan. Reply JSON:
{
  "say": "what you tell the band (<= 2 short sentences)",
  "motif": "the short cell you'll state in the head, compact notes, 1 bar (or 2 bars with |), in your sweet spot, rhythmically characteristic of the style",
  "motifIdea": "a few words",
  "arc": [{"bars": "1-4", "texture": "sparse|groove|build|peak|breakdown|tutti|stoptime|ostinato", "dynamic": "pp|p|mp|mf|f|ff"}, ... covering bars 1-${frame.bars}],
  "asks": {${others.map((m) => `"${m.id}": "<= 12 words for ${m.name}"`).join(", ")}}
}`,
        ].join("\n"),
        temperature: 0.9,
        maxOutputTokens: 1200,
        reasoning: "low",
      });
      const { value, error } = extractJson(text);
      if (error) noteRepair(call.id, error);
      const o = asRecord(value);
      setParsed(call.id, o);
      const repairs: string[] = [];
      const m = validateMotif(o.motif, o.motifIdea, frame, leader, repairs);
      if (m) {
        motif = m;
        plan = planLocal(frame, members, motif, rng.fork("plan"));
      }
      for (const a of Array.isArray(o.arc) ? o.arc : []) {
        const e = asRecord(a);
        const tex = asTexture(e.texture);
        const dyn = asDynamic(e.dynamic);
        for (const b1 of parseBarRange(e.bars ?? e.bar)) {
          const bp = plan[b1 - 1];
          if (!bp) continue;
          if (tex && bp.index !== frame.bars - 1) bp.texture = tex;
          if (dyn) bp.dynamic = dyn;
        }
      }
      for (const [k, v] of Object.entries(asRecord(o.asks))) {
        const mm = resolveMember(k, members);
        const t = asString(v, 120);
        if (mm && t) asks[mm.id] = t;
      }
      repairs.forEach((x) => noteRepair(call.id, x));
      const line = asString(o.say, 220);
      if (line) say(chatMsg(leader.id, line, "count-off", undefined, "band"));
      for (const [id, t] of Object.entries(asks)) say(chatMsg(leader.id, t, "count-off", undefined, id));
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error(`${leader.name} couldn't call the tune: ${(e as Error).message}`);
    }

    // ── Bandmates answer and pick their go-to texture ──
    step("The band is talking it over…");
    await Promise.all(
      others.map(async (m) => {
        try {
          const { text, call } = await callLLM({
            runId,
            apiKey,
            signal,
            label: "reply",
            agent: m.id,
            model: settings.playerModel,
            system: personaSystem(m, frame, "Bandstand talk is short and musical."),
            prompt: [
              styleBlock(frame),
              "",
              chartBlock(frame, members),
              "",
              motifBlock(motif),
              "",
              `${leader.name} said to the band: "${chat.find((c) => c.from === leader.id && c.to === "band")?.text ?? "Let's go."}"`,
              asks[m.id] ? `${leader.name} to you: "${asks[m.id]}"` : "",
              "",
              `Your usual accompaniment directive right now: ${plan.find((b) => !isFeaturedRole(b.roles[m.id]) && b.directives?.[m.id] !== "@rest")?.directives?.[m.id] ?? "@rest"}`,
              "Directives you can use when accompanying: @walk @two @bossa @funk @baroque @pedal (bass) · @comp [sparse|busy] @stride @arp @prelude @continuo @pad @shimmer (chords) · @guide @harmony @canon @riff @counter (horns/strings) · @groove [light|peak] (drums).",
              `Reply JSON: {"say": "<= 1 short sentence back to ${leader.name} or the band", "default": "your go-to directive when you're accompanying"}`,
            ]
              .filter(Boolean)
              .join("\n"),
            temperature: 0.9,
            maxOutputTokens: 300,
            reasoning: "none",
          });
          const { value } = extractJson(text);
          const o = asRecord(value);
          setParsed(call.id, o);
          const line = asString(o.say, 200);
          if (line) say(chatMsg(m.id, line, "count-off", undefined, leader.id));
          const d = asString(o.default, 60)?.trim();
          if (d && d.startsWith("@")) {
            const head = d.split(/\s+/)[0];
            const fn = INSTRUMENTS[m.instrument].fn;
            const okFor: Record<string, RegExp> = {
              rhythm: /^@(groove)$/,
              bass: /^@(walk|two|bossa|funk|baroque|pedal)$/,
              chordal: /^@(comp|stride|arp|prelude|continuo|pad|shimmer)$/,
              melodic: /^@(guide|harmony|canon|riff|counter|pad|arp)$/,
            };
            if (okFor[fn].test(head)) {
              for (const bp of plan) {
                const cur = bp.directives?.[m.id];
                if (isFeaturedRole(bp.roles[m.id]) || !cur || cur === "@rest" || cur === "@end") continue;
                bp.directives = { ...bp.directives, [m.id]: d };
              }
            } else noteRepair(call.id, `"${d}" isn't an accompaniment directive for ${fn}; kept the style default`);
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          dbg.step(runId, `${m.name} didn't answer (${(e as Error).message})`);
        }
      }),
    );
    plan = enforceSlots(plan, frame, members, []);
    dbg.timing(runId, "count-off", performance.now() - tStart);
    started = true;
    hooks.onScore(snapshot(false), false);

    // ── The jam: phrase by phrase, featured player first, then the band answers ──
    for (let pi = 0; pi < phrases.length; pi++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (stage[pi] === "done") continue;
      const bars = phrases[pi];
      const last = frame.bars - 1;
      const sec = sectionAt(frame, bars[0]);
      const prevBars = pi > 0 ? phrases[pi - 1] : [];
      const featuredIds = members
        .filter((m) => bars.some((b) => b !== last && isFeaturedRole(plan[b].roles[m.id])))
        .map((m) => m.id);
      step(`Bars ${bars[0] + 1}–${bars.at(-1)! + 1}: ${featuredIds.length ? `${featuredIds.map(nameOf).join(" & ")} ${sec.kind === "head" || sec.kind === "out" ? "on the head" : "stretching out"}` : "the band"}…`);
      const tPhrase = performance.now();

      const heard = prevBars.length
        ? playedBlock(members, parts, plan, frame, prevBars[0], prevBars.at(-1)!)
        : "  (nothing yet — this is the top of the tune)";

      // 1) featured players
      const fCalls = featuredIds.map(async (id) => {
        const m = members.find((x) => x.id === id)!;
        const myBars = bars.filter((b) => b !== last && isFeaturedRole(plan[b].roles[id]));
        try {
          const { text, call } = await callLLM({
            runId,
            apiKey,
            signal,
            label: `bars ${myBars[0] + 1}-${myBars.at(-1)! + 1}`,
            agent: id,
            model: settings.playerModel,
            system: personaSystem(m, frame, "It's your turn in the spotlight. Listen to what the band just played and keep the motif alive."),
            prompt: [
              styleBlock(frame),
              "",
              chartBlock(frame, members),
              "",
              motifBlock(motif),
              "",
              `WHAT THE BAND JUST PLAYED (bars ${prevBars.length ? `${prevBars[0] + 1}-${prevBars.at(-1)! + 1}` : "-"}):`,
              heard,
              "",
              "BAND TALK:",
              chatBlock(chat, members),
              "",
              `YOUR BARS:`,
              describeBars(myBars, frame, plan, id),
              "",
              NOTES_ONLY,
              m.instrument === "drums"
                ? "You're trading with the band: write each bar as a drum grid (lanes like sd:..x. t1:x... ft:...x bd:x...) built from the motif's rhythm, or use @solo."
                : `${INSTRUMENTS[m.instrument].breath ? `Breathe: leave a rest at least every ${INSTRUMENTS[m.instrument].breath} beats. ` : ""}A head states the motif recognizably; a solo starts from a transform of it (inverted, sequenced, displaced, fragmented) and develops — answer what you just heard, build toward the end of your solo, land on chord tones. You may also use a directive ("@motif invert", "@line dense") for a bar.`,
              `Reply: ${REPLY_SHAPE(myBars)}`,
            ].join("\n"),
            temperature: 0.95,
            maxOutputTokens: 1600,
            reasoning: "none",
          });
          if (stage[pi] !== "none") {
            noteRepair(call.id, "arrived after the band had already vamped through these bars; not used");
            return;
          }
          const { value, error } = extractJson(text);
          if (error) noteRepair(call.id, error);
          const o = asRecord(value);
          setParsed(call.id, o);
          const bmap = asRecord(o.bars);
          for (const b of myBars) {
            const raw = asString(bmap[String(b + 1)], 600);
            if (!raw) {
              noteRepair(call.id, `bar ${b + 1} missing; engine plays ${plan[b].directives?.[id]}`);
              continue;
            }
            const repairs: string[] = [];
            const clean = validateBarText(raw, m, frame.meter.beats, repairs, `bar ${b + 1}`);
            repairs.forEach((x) => noteRepair(call.id, x));
            if (clean && clean !== "@rest") plan[b].directives = { ...plan[b].directives, [id]: clean };
          }
          const line = asString(o.say, 160)?.trim();
          if (line) say(chatMsg(id, line, "jam", bars[0]));
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          dbg.step(runId, `${m.name} blanked on bars ${bars[0] + 1}+ (${(e as Error).message}); engine improvised`);
        }
      });
      await Promise.all(fCalls);
      if (stage[pi] !== "none") continue; // autopilot took this phrase
      realizeStage(pi, "featured");
      stage[pi] = "featured";

      // 2) everyone else listens to the featured line and answers
      const listenIds = featuredIds.length ? featuredIds : [leader.id];
      const listening = playedBlock(members, parts, plan, frame, bars[0], bars.at(-1)!, listenIds);
      const accIds = members
        .filter((m) => bars.some((b) => b !== last && !isFeaturedRole(plan[b].roles[m.id]) && plan[b].directives?.[m.id] !== "@end"))
        .map((m) => m.id);
      await Promise.all(
        accIds.map(async (id) => {
          const m = members.find((x) => x.id === id)!;
          const myBars = bars.filter((b) => b !== last && !isFeaturedRole(plan[b].roles[id]));
          try {
            const { text, call } = await callLLM({
              runId,
              apiKey,
              signal,
              label: `bars ${myBars[0] + 1}-${myBars.at(-1)! + 1}`,
              agent: id,
              model: settings.playerModel,
              system: personaSystem(m, frame, "You're accompanying right now. Listen to the featured player and support or answer them."),
              prompt: [
                styleBlock(frame),
                "",
                chartBlock(frame, members, bars[0], bars.at(-1)!),
                "",
                motifBlock(motif),
                "",
                `LISTEN — what ${listenIds.map(nameOf).join(" & ")} is playing over these bars:`,
                listening,
                "",
                "WHAT YOU PLAYED LAST PHRASE:",
                prevBars.length ? playedBlock(members, parts, plan, frame, prevBars[0], prevBars.at(-1)!, [id]) : "  (nothing yet)",
                "",
                "BAND TALK:",
                chatBlock(chat, members),
                "",
                "YOUR BARS:",
                describeBars(myBars, frame, plan, id),
                "",
                GRAMMAR,
                "",
                `Accompany in the style's texture: a directive keeps steady time; write notes or a drum grid when you want a specific answer (fill a gap the soloist leaves, a hit, a riff). Follow the dynamics. "@rest" is fine if laying out serves the music.`,
                `Reply: ${REPLY_SHAPE(myBars)}`,
              ].join("\n"),
              temperature: 0.85,
              maxOutputTokens: 1000,
              reasoning: "none",
            });
            if (stage[pi] === "done") {
              noteRepair(call.id, "arrived after the band had already vamped through these bars; not used");
              return;
            }
            const { value, error } = extractJson(text);
            if (error) noteRepair(call.id, error);
            const o = asRecord(value);
            setParsed(call.id, o);
            const bmap = asRecord(o.bars);
            for (const b of myBars) {
              const raw = asString(bmap[String(b + 1)], 600);
              if (!raw) continue;
              const repairs: string[] = [];
              const clean = validateBarText(raw, m, frame.meter.beats, repairs, `bar ${b + 1}`);
              repairs.forEach((x) => noteRepair(call.id, x));
              if (clean) plan[b].directives = { ...plan[b].directives, [id]: clean };
            }
            const line = asString(o.say, 160)?.trim();
            if (line) say(chatMsg(id, line, "jam", bars[Math.min(1, bars.length - 1)]));
          } catch (e) {
            if ((e as Error).name === "AbortError") throw e;
            dbg.step(runId, `${m.name} kept their default on bars ${bars[0] + 1}+ (${(e as Error).message})`);
          }
        }),
      );
      if (stage[pi] === "done") continue;
      plan = enforceSlots(plan, frame, members, []);
      realizeStage(pi, "rest");
      stage[pi] = "done";
      dbg.timing(runId, `phrase ${pi + 1}`, performance.now() - tPhrase);
      hooks.onScore(snapshot(false), false);
    }

    dbg.timing(runId, "total", performance.now() - tStart);
    const final = snapshot(true);
    useDebug.getState().endRun(runId, "done", issues);
    return final;
  })();

  return { promise, ensureReady, readyBars };
}
