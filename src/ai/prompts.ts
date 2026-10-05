import { DIRECTIVE_HELP } from "@/music/directives";
import { ANIMALS, INSTRUMENTS } from "@/music/instruments";
import { drumsToGrid, notesToText } from "@/music/notation";
import { harmonyOf } from "@/music/realize";
import { STYLES } from "@/music/styles";
import { keyPrefersFlats, pcName, pitchName } from "@/music/theory";
import type { BarPlan, ChatMessage, Frame, Member, Motif, NoteEvent } from "@/music/types";

export function styleBlock(frame: Frame): string {
  const s = STYLES[frame.style];
  return `STYLE — ${s.name}. Texture (this is what makes it sound like ${s.name}; follow it):\n${s.texture}`;
}

export function memberLine(m: Member, frame: Frame): string {
  const inst = INSTRUMENTS[m.instrument];
  const flats = keyPrefersFlats(frame.key);
  const range = inst.fn === "rhythm" ? "drum kit" : `range ${pitchName(inst.range[0], flats)}–${pitchName(inst.range[1], flats)}, sweet spot ${pitchName(inst.sweet[0], flats)}–${pitchName(inst.sweet[1], flats)}`;
  return `- ${m.id}: ${m.name} the ${ANIMALS[m.animal].species}, ${inst.name} (${inst.fn}; ${range})${m.id === frame.leaderId ? " — LEADER" : ""}`;
}

export function bandBlock(members: Member[], frame: Frame): string {
  return `BAND (use these ids)\n${members.map((m) => memberLine(m, frame)).join("\n")}`;
}

export function chartBlock(frame: Frame, members: Member[], from = 0, to = frame.bars - 1): string {
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const s = STYLES[frame.style];
  const lines: string[] = [];
  lines.push(
    `CHART (locked: length, form, changes and solo order are fixed — you only fill inside them)`,
    `${frame.bars} bars of ${frame.meter.beats}/4 in ${frame.key.tonic} ${frame.key.mode}, ${frame.tempo} bpm, feel: ${s.feelLabel}.`,
  );
  lines.push(
    "Form: " +
      frame.sections
        .map((x) => {
          const who = x.kind === "head" || x.kind === "out" ? ` (lead: ${nameOf(frame.leaderId)})` : "";
          return `${x.start + 1}-${x.start + x.length} ${x.name}${who}`;
        })
        .join(" | "),
  );
  const cells: string[] = [];
  for (let b = from; b <= to; b++) cells.push(`${b + 1}:${frame.chords[b].map((c) => c.symbol).join(" ")}`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4).join(" | "));
  lines.push("Changes (bar:chords; two chords split the bar):", ...rows.map((r) => "  " + r));
  return lines.join("\n");
}

/**
 * What each chord in these bars is, in context: its tones, the scale that fits it here, the
 * colors that can be held, and the notes that only pass. Models misalign pitch and harmony
 * more than anything else; spelling it out per bar fixes most of it at the source.
 */
export function harmonyBlock(frame: Frame, plan: BarPlan[], bars: number[]): string {
  const h = harmonyOf(frame, plan);
  const flats = keyPrefersFlats(frame.key);
  const names = (pcs: number[]) => pcs.map((pc) => pcName(pc, flats)).join(" ");
  const beats = frame.meter.beats;
  const lines = bars.map((b) => {
    const spans = h.spans.filter((s) => s.start >= b * beats - 1e-6 && s.start < (b + 1) * beats - 1e-6);
    const at = spans.length ? spans : [h.at(b * beats)];
    return `  bar ${b + 1}: ${at
      .map((s) => {
        const pass = s.scale.filter((pc) => !s.stable.includes(pc));
        return `${s.chord.symbol} = chord ${names(s.tones)}${s.colors.length ? `, colors ${names(s.colors)}` : ""}${pass.length ? `; ${names(pass)} only in passing` : ""}`;
      })
      .join(" | ")}`;
  });
  return `HARMONY (land and hold on chord tones or colors; scale notes between them; never hold an "only in passing" note):\n${lines.join("\n")}`;
}

export function motifBlock(m: Motif): string {
  return `MOTIF (the band's shared cell): ${m.text}${m.description ? `  — ${m.description}` : ""}`;
}

export const GRAMMAR = DIRECTIVE_HELP;

export const NOTES_ONLY = `Notes: "pitch/duration" e.g. "Bb4/8 C5/8 D5/4 r/4 F5/4"; durations 1 2 4 8 16, "." dotted, "t" triplet (three 8t = one beat), "r" rest, "~" ties to the next note; chords as [C4 E4 G4]/2. Sounding pitch, octave numbers with C4 = middle C. Each bar's durations must add up exactly to the bar.`;

/** What a member played in some bars, compactly, for listening. */
export function playedBlock(
  members: Member[],
  parts: Record<string, NoteEvent[]>,
  plan: BarPlan[],
  frame: Frame,
  from: number,
  to: number,
  only?: string[],
): string {
  const beats = frame.meter.beats;
  const flats = keyPrefersFlats(frame.key);
  const out: string[] = [];
  for (const m of members) {
    if (only && !only.includes(m.id)) continue;
    const cells: string[] = [];
    for (let b = from; b <= to; b++) {
      const d = plan[b]?.directives?.[m.id] ?? "";
      const notes = (parts[m.id] ?? [])
        .filter((n) => n.start >= b * beats - 1e-6 && n.start < (b + 1) * beats - 1e-6)
        .map((n) => ({ ...n, start: n.start - b * beats }));
      const inst = INSTRUMENTS[m.instrument];
      let shown: string;
      if (!notes.length) shown = "(rest)";
      else if (inst.fn === "rhythm") shown = d.startsWith("@") ? `${d} (${notes.length} hits)` : drumsToGrid(notes, beats);
      else if (inst.poly && d.startsWith("@") && !d.startsWith("@motif") && !d.startsWith("@line")) shown = d;
      else shown = notesToText(notes, beats, flats);
      cells.push(`${b + 1}: ${shown}`);
    }
    out.push(`  ${m.name} (${INSTRUMENTS[m.instrument].name}): ${cells.join(" | ")}`);
  }
  return out.join("\n");
}

/**
 * The engine's own rendition of some bars for one player, as a concrete in-style
 * reference the model can improve on (keeps weaker models in range and in idiom).
 */
export function sketchBlock(member: Member, bars: number[], parts: Record<string, NoteEvent[]>, frame: Frame): string {
  const beats = frame.meter.beats;
  const flats = keyPrefersFlats(frame.key);
  const lines = bars.map((b) => {
    const notes = (parts[member.id] ?? [])
      .filter((n) => n.start >= b * beats - 1e-6 && n.start < (b + 1) * beats - 1e-6)
      .map((n) => ({ ...n, start: n.start - b * beats }));
    return `  bar ${b + 1}: ${notes.length ? notesToText(notes, beats, flats) : "(rest)"}`;
  });
  return `A SKETCH of these bars from the band's engine (in range and in style, but plain — don't copy it; write something more musical that develops the motif):\n${lines.join("\n")}`;
}

export function chatBlock(chat: ChatMessage[], members: Member[], last = 8): string {
  const nameOf = (id: string) => (id === "director" ? "Director" : (members.find((m) => m.id === id)?.name ?? id));
  const recent = chat.slice(-last);
  if (!recent.length) return "(nobody has said anything yet)";
  return recent.map((c) => `  ${nameOf(c.from)}: "${c.text}"`).join("\n");
}

export function personaSystem(m: Member, frame: Frame, extra: string): string {
  const a = ANIMALS[m.animal];
  const inst = INSTRUMENTS[m.instrument];
  return [
    `You are ${m.name} the ${a.species}, playing ${inst.name} in a small doodled animal band that improvises together.`,
    `Personality: ${a.persona}.`,
    `You think like a real improvising musician: listen, leave space, answer phrases, build arcs, and keep the band's motif alive.`,
    extra,
    `Always reply with a single JSON object and nothing else.`,
  ].join("\n");
}

export const DIRECTOR_SYSTEM = [
  "You are the musical director of a small doodled animal band. You write the chart for everyone: a hierarchical plan inside a locked frame (length, form, changes and solo order are fixed by the bandstand; you fill textures, dynamics, motif and each player's bars).",
  "Distinctness comes from texture: every player's part should embody the style's texture priors, not just the style's name. A shared motif ties the take together: the leader states a short cell, solos are transforms of it, everyone else comps.",
  "Always reply with a single JSON object and nothing else.",
].join("\n");

export const CRITIC_SYSTEM = [
  "You are a terse judge helping a music director pick the best of several candidate plans.",
  "Score each candidate 0-10 on distinctiveness (how unmistakably it embodies the requested style's TEXTURE — rhythm-section patterns, density, register, articulation — versus generic filler) and coherence (motif stated and developed, solo arc builds, dynamics shape the form).",
  "Reply with a single JSON object and nothing else.",
].join("\n");
