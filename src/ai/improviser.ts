import { newMemory, type PlayerMemory } from "@/music/context";
import { ritFor } from "@/music/ending";
import { buildFrame, sectionAt } from "@/music/form";
import { INSTRUMENTS } from "@/music/instruments";
import { motifForFrame, newScoreId } from "@/music/local";
import { planLocal } from "@/music/planner";
import { isFeaturedRole, realize } from "@/music/realize";
import { makeRng } from "@/music/rng";
import { STYLES, swingAt } from "@/music/styles";
import type { BarPlan, ChatMessage, Frame, Member, Motif, NoteEvent, Score, TroopSettings } from "@/music/types";
import { useDebug } from "@/state/debug";
import { chatMsg, type PipelineHooks } from "./composer";
import { asRecord, asString, extractJson, parseBarRange } from "./json";
import { callLLM, LlmError, noteRepair, setParsed } from "./llm";
import { accompanimentFits, applyDefault, asDynamic, asTexture, enforceSlots, resolveMember, usualDirective, validateBarText, validateMotif } from "./merge";
import { barsSchema, countOffSchema, replySchema } from "./schemas";
import {
  arcNote,
  bandBlock,
  chartBlock,
  chatBlock,
  GRAMMAR,
  harmonyBlock,
  motifBlock,
  NOTES_ONLY,
  personaSystem,
  playedBlock,
  sketchBlock,
  styleBlock,
} from "./prompts";

export interface ImprovController {
  promise: Promise<Score>;
  /** Make sure every bar up to `bar` is playable; unready phrases get the band's autopilot. */
  ensureReady(bar: number): boolean;
  /** Number of bars realized so far (from the top). */
  readyBars(): number;
  /** Bars the band vamped through on autopilot. */
  autopilotBars(): number[];
  /**
   * Is it safe to start playback now? True once the remaining phrases will (at the band's
   * measured pace) be ready before the playhead reaches them.
   */
  readyToPlay(secondsPerBeat: number): boolean;
}

type Stage = "none" | "featured" | "done";

function describeBars(bars: number[], frame: Frame, plan: BarPlan[], memberId: string): string {
  return bars
    .map((b) => {
      const bp = plan[b];
      const arc = arcNote(frame, b, bp.roles[memberId]);
      return `  bar ${b + 1}: ${frame.chords[b].map((c) => c.symbol).join(" ")} · ${bp.section} · you: ${bp.roles[memberId]} (${bp.directives?.[memberId] ?? "@rest"}) · ${bp.dynamic}/${bp.texture}${arc ? ` · ${arc}` : ""}`;
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
  // each phrase's model calls can be called off once autopilot has played it, freeing their
  // slots (and the user's key) for the phrases still to come
  const phraseCtl = phrases.map(() => new AbortController());
  const phraseSignal = (pi: number) => AbortSignal.any([signal, phraseCtl[pi].signal]);
  /** A call cut short: rethrow if the whole run was cancelled, otherwise the phrase went on without it. */
  const calledOff = (e: unknown) => {
    if ((e as Error).name !== "AbortError") return false;
    if (signal.aborted) throw e;
    return true;
  };
  const autopilot = new Set<number>();
  let countedOffAlone = false; // the count-off call failed: the band's own motif and plan
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
  const phraseDoneAt: number[] = [];

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
    swing: swingAt(style, frame.tempo),
    rit: ritFor(frame),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, [...v].sort((a, b) => a.start - b.start)])),
    chat: [...chat],
    engine: "ai",
    notes: [
      `Leader ${nameOf(leader.id)} on ${settings.directorModel}; band on ${settings.playerModel}.`,
      ...(countedOffAlone ? [`${nameOf(leader.id)}'s count-off call failed, so the band played its own motif and plan.`] : []),
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
      phraseCtl[pi].abort();
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
        schema: countOffSchema(others.map((m) => m.id)),
        schemaName: "count_off",
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
      // a bad key stops the jam; anything else (an outage, a timeout) and the leader just counts
      // off the band's own motif and plan, and the bandmates still have their say
      const status = e instanceof LlmError ? e.status : 0;
      if (status === 401 || status === 403) throw new Error(`${leader.name} couldn't call the tune: ${(e as Error).message}`);
      countedOffAlone = true;
      dbg.step(runId, `${leader.name}'s count-off failed (${(e as Error).message}); counting off the sketch's motif and plan`);
      say(chatMsg(leader.id, "Let's just play it. One, two…", "count-off", undefined, "band"));
    }

    // ── Bandmates answer and pick their go-to texture (while the leader plays the first phrase) ──
    step("The band is talking it over…");
    const repliesDone = Promise.all(
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
              `Your usual accompaniment directive right now: ${usualDirective(plan, m.id) ?? "@rest"}`,
              "Directives you can use when accompanying: @walk @two @bossa @funk @baroque @pedal (bass) · @comp [sparse|busy] @stride @arp @prelude @continuo @pad @shimmer (chords) · @guide @harmony @canon @riff @counter (horns/strings) · @pizz [sparse|busy] @arco (cello) · @groove [light|peak] (drums).",
              `Reply JSON: {"say": "<= 1 short sentence back to ${leader.name} or the band", "default": "your go-to directive when you're accompanying"}`,
            ]
              .filter(Boolean)
              .join("\n"),
            temperature: 0.9,
            maxOutputTokens: 300,
            reasoning: "none",
            schema: replySchema(),
            schemaName: "reply",
          });
          const { value } = extractJson(text);
          const o = asRecord(value);
          setParsed(call.id, o);
          const line = asString(o.say, 200);
          if (line) say(chatMsg(m.id, line, "count-off", undefined, leader.id));
          const d = asString(o.default, 60)?.trim();
          if (d && d.startsWith("@")) {
            const head = d.split(/\s+/)[0];
            const role = plan.find((b) => !isFeaturedRole(b.roles[m.id]) && b.directives?.[m.id] !== "@rest")?.roles[m.id];
            if (accompanimentFits(head, m, role)) applyDefault(plan, m.id, d);
            else noteRepair(call.id, `"${d}" isn't an accompaniment directive for ${INSTRUMENTS[m.instrument].name.toLowerCase()}; kept the style default`);
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          dbg.step(runId, `${m.name} didn't answer (${(e as Error).message})`);
        }
      }),
    );

    // ── The jam, pipelined: each phrase is the featured player first, then the band answering
    // what it heard; the next phrase's featured player starts thinking while the band answers,
    // so the band needs one model round per phrase, not two, to keep up with playback. ──
    const featuredPhase = async (pi: number) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (stage[pi] !== "none") return;
      const bars = phrases[pi];
      const last = frame.bars - 1;
      const sec = sectionAt(frame, bars[0]);
      const prevBars = pi > 0 ? phrases[pi - 1] : [];
      // bars where the tune comes back (@head) are the melody as already played: nobody rewrites them
      const writes = (id: string, b: number) => b !== last && isFeaturedRole(plan[b].roles[id]) && !plan[b].directives?.[id]?.startsWith("@head");
      const featuredIds = members.filter((m) => bars.some((b) => writes(m.id, b))).map((m) => m.id);
      step(`Bars ${bars[0] + 1}–${bars.at(-1)! + 1}: ${featuredIds.length ? `${featuredIds.map(nameOf).join(" & ")} ${sec.kind === "head" || sec.kind === "out" ? "on the head" : "stretching out"}` : "the band"}…`);
      const tPhrase = performance.now();

      // the previous phrase's accompaniment may still be in flight: share what has been played
      const prevFeatured = prevBars.length
        ? members.filter((m) => prevBars.some((b) => b !== last && isFeaturedRole(plan[b].roles[m.id]))).map((m) => m.id)
        : [];
      const heard = !prevBars.length
        ? "  (nothing yet — this is the top of the tune)"
        : stage[pi - 1] === "done"
          ? playedBlock(members, parts, plan, frame, prevBars[0], prevBars.at(-1)!)
          : playedBlock(members, parts, plan, frame, prevBars[0], prevBars.at(-1)!, prevFeatured.length ? prevFeatured : [leader.id]) +
            "\n  (the rest of the band was comping in style underneath)";

      // 1) featured players (each gets the engine's sketch of their bars as a reference)
      const preview = realize({
        frame,
        members,
        plan,
        motif,
        seed: settings.seed,
        bars,
        memories: new Map([...memories].map(([k, v]) => [k, structuredClone(v)])),
        priorFeatured: new Map(featuredByBar),
        filter: (mid, bar) => featuredIds.includes(mid) && isFeaturedRole(plan[bar]?.roles[mid]),
      });
      const fCalls = featuredIds.map(async (id) => {
        const m = members.find((x) => x.id === id)!;
        const myBars = bars.filter((b) => writes(id, b));
        try {
          const { text, call } = await callLLM({
            runId,
            apiKey,
            signal: phraseSignal(pi),
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
              m.instrument === "drums" ? "" : harmonyBlock(frame, plan, myBars),
              "",
              m.instrument === "drums" ? "" : sketchBlock(m, myBars, preview.parts, frame),
              "",
              NOTES_ONLY,
              m.instrument === "drums"
                ? "You're trading with the band: write each bar as a drum grid (lanes like sd:..x. t1:x... ft:...x bd:x...) built from the motif's rhythm, or use @solo."
                : `${INSTRUMENTS[m.instrument].breath ? `Breathe: leave a rest at least every ${INSTRUMENTS[m.instrument].breath} beats. ` : ""}A head states the motif recognizably; a solo starts from a transform of it (inverted, sequenced, displaced, fragmented) and develops — answer what you just heard, build toward the end of your solo. Think in phrases, not bars: start a phrase on a pickup, give it a direction (climb, fall, arch), land it on a chord tone on a strong beat, then breathe. Keep rhythms on the beat grid (whole beats of 8ths, a full triplet, 16ths in funk). You may also use a directive ("@motif invert", "@line dense") for a bar.`,
              `Reply: ${REPLY_SHAPE(myBars)}`,
            ].join("\n"),
            temperature: 0.95,
            maxOutputTokens: 1600,
            reasoning: "none",
            schema: barsSchema(myBars.map((b) => b + 1), true),
            schemaName: "phrase",
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
            const clean = validateBarText(raw, m, frame.meter.beats, repairs, `bar ${b + 1}`, frame.slots[b]?.[id] ?? plan[b].roles[id]);
            repairs.forEach((x) => noteRepair(call.id, x));
            if (clean && clean !== "@rest") plan[b].directives = { ...plan[b].directives, [id]: clean };
          }
          const line = asString(o.say, 160)?.trim();
          if (line) say(chatMsg(id, line, "jam", bars[0]));
        } catch (e) {
          if (calledOff(e)) return; // autopilot already played these bars
          dbg.step(runId, `${m.name} blanked on bars ${bars[0] + 1}+ (${(e as Error).message}); engine improvised`);
        }
      });
      await Promise.all(fCalls);
      if (stage[pi] !== "none") return; // autopilot took this phrase
      realizeStage(pi, "featured");
      stage[pi] = "featured";
      dbg.timing(runId, `phrase ${pi + 1} featured`, performance.now() - tPhrase);
    };

    const accompanimentPhase = async (pi: number) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (stage[pi] !== "featured") return; // autopilot took it (or nobody was featured and it was realized already)
      const bars = phrases[pi];
      const last = frame.bars - 1;
      const prevBars = pi > 0 ? phrases[pi - 1] : [];
      const tPhrase = performance.now();
      const featuredIds = members
        .filter((m) => bars.some((b) => b !== last && isFeaturedRole(plan[b].roles[m.id])))
        .map((m) => m.id);
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
              signal: phraseSignal(pi),
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
              schema: barsSchema(myBars.map((b) => b + 1), true),
              schemaName: "phrase",
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
              const clean = validateBarText(raw, m, frame.meter.beats, repairs, `bar ${b + 1}`, frame.slots[b]?.[id] ?? plan[b].roles[id]);
              repairs.forEach((x) => noteRepair(call.id, x));
              if (clean) plan[b].directives = { ...plan[b].directives, [id]: clean };
            }
            const line = asString(o.say, 160)?.trim();
            if (line) say(chatMsg(id, line, "jam", bars[Math.min(1, bars.length - 1)]));
          } catch (e) {
            if (calledOff(e)) return; // autopilot already played these bars
            dbg.step(runId, `${m.name} kept their default on bars ${bars[0] + 1}+ (${(e as Error).message})`);
          }
        }),
      );
      // re-read: autopilot may have taken this phrase while the band was thinking
      if ((stage[pi] as Stage) === "done") return;
      plan = enforceSlots(plan, frame, members, []);
      realizeStage(pi, "rest");
      stage[pi] = "done";
      phraseDoneAt.push(performance.now());
      dbg.timing(runId, `phrase ${pi + 1} band`, performance.now() - tPhrase);
      hooks.onScore(snapshot(false), false);
    };

    let nextFeatured = featuredPhase(0);
    await repliesDone;
    plan = enforceSlots(plan, frame, members, []);
    dbg.timing(runId, "count-off", performance.now() - tStart);
    started = true;
    hooks.onScore(snapshot(false), false);
    for (let pi = 0; pi < phrases.length; pi++) {
      await nextFeatured;
      const band = accompanimentPhase(pi);
      nextFeatured = pi + 1 < phrases.length ? featuredPhase(pi + 1) : Promise.resolve();
      await band;
    }
    await nextFeatured;

    dbg.timing(runId, "total", performance.now() - tStart);
    const final = snapshot(true);
    useDebug.getState().endRun(runId, "done", issues);
    return final;
  })();

  /** Seconds the band takes per phrase: measured between finished phrases, else from call latency. */
  const pace = (): number => {
    if (phraseDoneAt.length >= 2) return (phraseDoneAt[phraseDoneAt.length - 1] - phraseDoneAt[0]) / (phraseDoneAt.length - 1) / 1000;
    const done = useDebug.getState().calls.filter((c) => c.runId === runId && c.status === "ok" && c.ms);
    const avg = done.length ? done.reduce((s, c) => s + (c.ms ?? 0), 0) / done.length : 3000;
    return (avg * 1.25) / 1000; // one round per phrase (pipelined) plus jitter
  };

  const readyToPlay = (spb: number): boolean => {
    let r = 0;
    while (r < phrases.length && stage[r] === "done") r++;
    if (r === 0) return false;
    if (r === phrases.length) return true;
    const beats = frame.meter.beats;
    const countIn = beats * spb;
    const P = pace();
    const margin = spb * 1.5; // autopilot steps in ~¾ beat early; leave a little more
    // phrase k starts playing at countIn + start(k)·spb; it's ready ~ (k − r + 1)·P from now
    for (let k = r; k < phrases.length; k++) {
      const playsAt = countIn + phrases[k][0] * beats * spb;
      if ((k - r + 1) * P > playsAt - margin) return false;
    }
    return true;
  };

  return { promise, ensureReady, readyBars, autopilotBars: () => [...autopilot].flatMap((pi) => phrases[pi]), readyToPlay };
}
