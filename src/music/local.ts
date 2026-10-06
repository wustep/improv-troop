import { DEFAULT_DIRECTOR_MODEL, DEFAULT_PLAYER_MODEL } from "@/ai/models";
import { buildFrame } from "./form";
import { INSTRUMENTS } from "./instruments";
import { generateMotif, motifFromText, transposeMotif } from "./motif";
import { planLocal } from "./planner";
import { realize, type RealizeIssue } from "./realize";
import { makeRng } from "./rng";
import { getStandard } from "./standards";
import { STYLES, swingAt } from "./styles";
import { mod, pcOf } from "./theory";
import type { Frame, Member, Motif, Score, TroopSettings } from "./types";

export function defaultSettings(members: Member[]): TroopSettings {
  const style = STYLES.swing;
  const leader = members.find((m) => INSTRUMENTS[m.instrument].fn === "melodic") ?? members[0];
  return {
    mode: "improviser",
    style: "swing",
    bars: 16,
    tempo: style.tempo.default,
    key: { ...style.key },
    meter: { beats: 4 },
    standard: null,
    leaderId: leader?.id ?? "",
    soloists: members.filter((m) => m.id !== leader?.id && m.instrument !== "drums" && m.instrument !== "bass").map((m) => m.id).slice(0, 2),
    bestOf: 4,
    seed: 1,
    directorModel: DEFAULT_DIRECTOR_MODEL,
    playerModel: DEFAULT_PLAYER_MODEL,
    phraseBars: 4,
  };
}

export function motifForFrame(frame: Frame, members: Member[], rng = makeRng(1)): Motif {
  const std = getStandard(frame.standard);
  const leader = members.find((m) => m.id === frame.leaderId) ?? members[0];
  const inst = INSTRUMENTS[leader?.instrument ?? "trumpet"];
  const firstChord = frame.chords[0][0].symbol;
  if (std?.motif) {
    let m = motifFromText(std.motif, frame.meter.beats, firstChord, `${std.name} (public domain head)`);
    let semis = mod(pcOf(frame.key.tonic) - pcOf(std.key.tonic), 12);
    if (semis > 6) semis -= 12;
    if (semis) m = transposeMotif(m, semis, frame.key);
    // put it in the leader's register
    const center = m.notes.reduce((s, n) => s + n.pitch, 0) / Math.max(1, m.notes.length);
    const want = (inst.sweet[0] + inst.sweet[1]) / 2;
    const oct = Math.round((want - center) / 12) * 12;
    if (oct) m = transposeMotif(m, oct, frame.key);
    return m;
  }
  // the tune sits in the upper middle of the leader's voice, over the band
  const range: [number, number] = [inst.sweet[0] + 5, Math.min(inst.sweet[1], inst.sweet[0] + 22)];
  return generateMotif(STYLES[frame.style], frame.key, firstChord, frame.meter.beats, range, rng);
}

export function newScoreId() {
  return `take-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface LocalResult {
  score: Score;
  issues: RealizeIssue[];
  timings: { frameMs: number; planMs: number; realizeMs: number };
}

/** The stub band: plays a full chart with no model calls. Same settings + seed = same take. */
export function generateLocal(settings: TroopSettings, members: Member[]): LocalResult {
  const t0 = performance.now();
  const frame = buildFrame(settings, members);
  const t1 = performance.now();
  const rng = makeRng(settings.seed);
  const motif = motifForFrame(frame, members, rng.fork("motif"));
  const plan = planLocal(frame, members, motif, rng.fork("plan"));
  const t2 = performance.now();
  const res = realize({ frame, members, plan, motif, seed: settings.seed });
  const style = STYLES[settings.style];
  const score: Score = {
    id: newScoreId(),
    title: `${style.name}${frame.standard ? ` · ${getStandard(frame.standard)?.name}` : ""}`,
    createdAt: Date.now(),
    settings,
    members,
    frame,
    plan,
    motif,
    swing: swingAt(style, frame.tempo),
    parts: res.parts,
    chat: [],
    engine: "local",
    notes: [`Local engine, seed ${settings.seed}.`],
  };
  return { score, issues: res.issues, timings: { frameMs: t1 - t0, planMs: t2 - t1, realizeMs: res.ms } };
}
