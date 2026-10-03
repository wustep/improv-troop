import { INSTRUMENTS } from "@/music/instruments";
import { chordPcs, mod, parseChord } from "@/music/theory";
import type { BarPlan, Frame, Member, NoteEvent } from "@/music/types";

/** Cheap texture features of a realized candidate, so the critic judges sound, not just labels. */
export function textureFeatures(frame: Frame, members: Member[], plan: BarPlan[], parts: Record<string, NoteEvent[]>): string {
  const beats = frame.meter.beats;
  const total = frame.bars * beats;
  const lines: string[] = [];
  for (const m of members) {
    const notes = parts[m.id] ?? [];
    const inst = INSTRUMENTS[m.instrument];
    const onsets = [...new Set(notes.map((n) => Math.round(n.start * 12)))];
    const density = onsets.length / total;
    const offbeat = onsets.filter((o) => o % 12 !== 0).length / Math.max(1, onsets.length);
    let detail = `${(density).toFixed(2)} onsets/beat, ${(offbeat * 100).toFixed(0)}% off the beat`;
    if (inst.fn !== "rhythm" && notes.length) {
      const pitches = notes.map((n) => n.pitch);
      const avgDur = notes.reduce((s, n) => s + n.dur, 0) / notes.length;
      detail += `, register ${Math.min(...pitches)}–${Math.max(...pitches)}, avg note ${avgDur.toFixed(2)} beats`;
      let ct = 0;
      let strong = 0;
      for (const n of notes) {
        if (Math.abs(n.start - Math.round(n.start)) > 1e-6) continue;
        strong++;
        const bar = Math.floor(n.start / beats);
        const syms = frame.chords[bar] ?? [];
        let sym = syms[0]?.symbol ?? "C";
        for (const c of syms) if (c.beat <= n.start - bar * beats + 1e-6) sym = c.symbol;
        if (chordPcs(parseChord(sym)).includes(mod(n.pitch, 12))) ct++;
      }
      if (strong) detail += `, ${((ct / strong) * 100).toFixed(0)}% chord tones on beats`;
    }
    const kinds = new Map<string, number>();
    for (const bp of plan) {
      const d = (bp.directives?.[m.id] ?? "@rest").split(/\s+/)[0];
      const k = d.startsWith("@") ? d : d.includes(":") ? "grid" : "notes";
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    lines.push(`  ${m.name} (${inst.name}): ${detail}; parts ${[...kinds.entries()].map(([k, v]) => `${k}×${v}`).join(" ")}`);
  }
  const dyn = plan.map((b) => b.dynamic).join(" ");
  const tex = plan.map((b) => b.texture).join(" ");
  lines.push(`  dynamics: ${dyn}`, `  textures: ${tex}`);
  return lines.join("\n");
}
