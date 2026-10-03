import { INSTRUMENTS } from "./instruments";
import { makeRng } from "./rng";
import { getStandard } from "./standards";
import { STYLES } from "./styles";
import { mod, pcOf, romanToChord, transposeChordSymbol, keyPrefersFlats } from "./theory";
import type { ChordChange, Frame, Member, Role, Section, TroopSettings } from "./types";

// Level 0 of the hierarchy: the locked frame. Length, form, harmony and the
// lead/solo slots are decided here in code; planners (local or model) only fill
// inside it and are never allowed to change the bar count.

export const FREE_LENGTHS = [8, 12, 16, 24, 32];

export function lengthOptions(standardId: string | null): number[] {
  const std = getStandard(standardId);
  if (!std) return FREE_LENGTHS;
  const len = std.bars.length;
  const out: number[] = [];
  for (let n = 1; n * len <= 48; n++) out.push(n * len);
  return out.length ? out : [len];
}

export function snapLength(standardId: string | null, bars: number): number {
  const opts = lengthOptions(standardId);
  let best = opts[0];
  for (const o of opts) if (Math.abs(o - bars) < Math.abs(best - bars)) best = o;
  return best;
}

function splitBar(text: string, beats: number): ChordChange[] {
  const syms = text.trim().split(/\s+/).filter(Boolean);
  if (syms.length <= 1) return [{ beat: 0, symbol: syms[0] ?? "C" }];
  if (beats === 3 && syms.length === 2) return [{ beat: 0, symbol: syms[0] }, { beat: 2, symbol: syms[1] }];
  const step = beats / syms.length;
  return syms.map((s, i) => ({ beat: Math.round(i * step * 2) / 2, symbol: s }));
}

function tonicChord(settings: TroopSettings): string {
  const style = settings.style;
  const minor = settings.key.mode === "minor";
  const t = settings.key.tonic;
  if (style === "swing") return minor ? `${t}m6` : `${t}6`;
  if (style === "bossa") return minor ? `${t}m7` : `${t}maj7`;
  if (style === "funk") return minor ? `${t}m7` : `${t}7`;
  if (style === "ambient") return minor ? `${t}m9` : `${t}maj7`;
  return minor ? `${t}m` : t;
}

function dominantOf(settings: TroopSettings): string {
  const pc = pcOf(settings.key.tonic) + 7;
  const flats = keyPrefersFlats(settings.key);
  const names = flats
    ? ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
    : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[mod(pc, 12)]}7`;
}

interface SoloPlan {
  start: number;
  length: number;
  soloist: string;
}

function assignSolos(start: number, length: number, soloists: string[], unit: number): SoloPlan[] {
  if (!soloists.length || length <= 0) return [];
  const k = soloists.length;
  // biggest multiple of `unit` (4, else 2) that gives everyone a turn
  let each = Math.floor(length / k / unit) * unit;
  if (each < unit) each = unit === 4 && length / k >= 2 ? 2 : unit;
  const out: SoloPlan[] = [];
  let t = start;
  for (let i = 0; i < k && t < start + length; i++) {
    const remaining = start + length - t;
    const isLast = i === k - 1 || t + each * 2 > start + length;
    const len = isLast ? remaining : Math.min(each, remaining);
    out.push({ start: t, length: len, soloist: soloists[i] });
    t += len;
    if (isLast) break;
  }
  return out;
}

export function buildFrame(settings: TroopSettings, members: Member[]): Frame {
  const std = getStandard(settings.standard);
  const style = STYLES[settings.style];
  const beats = std ? std.meter : settings.meter.beats;
  const rng = makeRng(settings.seed).fork("frame");
  const total = std ? snapLength(std.id, settings.bars) : Math.max(4, Math.round(settings.bars));
  const flats = keyPrefersFlats(settings.key);

  // ── Harmony ──
  let barTexts: string[] = [];
  if (std) {
    let semis = mod(pcOf(settings.key.tonic) - pcOf(std.key.tonic), 12);
    if (semis > 6) semis -= 12;
    for (let i = 0; i < total; i++) {
      const raw = std.bars[i % std.bars.length];
      barTexts.push(
        raw
          .split(/\s+/)
          .map((s) => transposeChordSymbol(s, semis, flats))
          .join(" "),
      );
    }
  } else {
    const prog = rng.pick(style.progressions[settings.key.mode]);
    const romanBars = Array.from({ length: total }, (_, i) => prog[i % prog.length]);
    barTexts = romanBars.map((bar) =>
      bar
        .split(/\s+/)
        .map((tok) => romanToChord(tok, settings.key))
        .join(" "),
    );
    // cadence: dominant then tonic at the very end
    if (total >= 4) barTexts[total - 2] = dominantOf(settings);
    barTexts[total - 1] = tonicChord(settings);
  }
  const chords = barTexts.map((t) => splitBar(t, beats));

  // ── Form ──
  const memberIds = new Set(members.map((m) => m.id));
  const leaderOk = (id: string) => memberIds.has(id) && members.find((m) => m.id === id)?.instrument !== "drums";
  const leaderId = leaderOk(settings.leaderId)
    ? settings.leaderId
    : (members.find((m) => INSTRUMENTS[m.instrument].fn === "melodic") ??
        members.find((m) => m.instrument !== "drums") ??
        members[0])?.id ?? "";
  const soloists = settings.soloists.filter((id) => memberIds.has(id));
  const drummer = members.find((m) => m.instrument === "drums")?.id;
  const sections: Section[] = [];
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  const pushSolos = (start: number, length: number) => {
    const melodicSoloists = soloists.filter((s) => s !== drummer);
    const drumsSolo = drummer && soloists.includes(drummer);
    const plans = assignSolos(start, length, melodicSoloists.length ? melodicSoloists : drumsSolo ? [] : [leaderId], length >= 8 ? 4 : 2);
    if (drumsSolo) {
      // the drummer trades 2s with the last soloist (or the leader) in the final slot
      const tradeLen = Math.min(length, Math.max(4, Math.floor(length / (plans.length + 1) / 2) * 2 || 4));
      if (plans.length) {
        const last = plans[plans.length - 1];
        if (last.length > tradeLen) {
          last.length -= tradeLen;
        } else {
          plans.pop();
        }
      }
      for (const p of plans) sections.push({ name: `Solo · ${nameOf(p.soloist)}`, kind: "solo", start: p.start, length: p.length, featured: [p.soloist] });
      const tStart = start + length - Math.min(tradeLen, length);
      const partner = melodicSoloists[melodicSoloists.length - 1] ?? leaderId;
      sections.push({
        name: `Trading 2s · ${nameOf(partner)} & ${nameOf(drummer!)}`,
        kind: "trade",
        start: tStart,
        length: start + length - tStart,
        featured: [partner, drummer!],
      });
    } else {
      for (const p of plans) sections.push({ name: `Solo · ${nameOf(p.soloist)}`, kind: "solo", start: p.start, length: p.length, featured: [p.soloist] });
    }
  };

  if (std) {
    const formLen = std.bars.length;
    const choruses = Math.max(1, Math.round(total / formLen));
    if (choruses === 1) {
      if (soloists.length && formLen >= 16) {
        const half = Math.floor(formLen / 2);
        sections.push({ name: "Head", kind: "head", start: 0, length: half, featured: [leaderId] });
        pushSolos(half, total - half);
      } else {
        sections.push({ name: "Head", kind: "head", start: 0, length: total, featured: [leaderId] });
      }
    } else {
      sections.push({ name: "Head", kind: "head", start: 0, length: formLen, featured: [leaderId] });
      const hasOut = choruses >= 3;
      const soloStart = formLen;
      const soloLen = total - formLen - (hasOut ? formLen : 0);
      pushSolos(soloStart, soloLen);
      if (hasOut) sections.push({ name: "Out Head", kind: "out", start: total - formLen, length: formLen, featured: [leaderId] });
    }
  } else {
    let head = total >= 24 ? 8 : 4;
    let out = total >= 12 ? (total >= 24 ? 8 : 4) : 0;
    if (total <= 8) {
      head = 4;
      out = 0;
    }
    const soloLen = total - head - out;
    sections.push({ name: "Head", kind: "head", start: 0, length: head, featured: [leaderId] });
    if (soloLen > 0) pushSolos(head, soloLen);
    if (out > 0) sections.push({ name: "Out Head", kind: "out", start: total - out, length: out, featured: [leaderId] });
  }
  sections.sort((a, b) => a.start - b.start);

  // ── Locked slots ──
  const slots: Record<string, Role>[] = Array.from({ length: total }, () => ({}));
  for (const s of sections) {
    for (let b = s.start; b < s.start + s.length; b++) {
      if (s.kind === "head" || s.kind === "out") {
        if (leaderId) slots[b][leaderId] = "lead";
      } else if (s.kind === "solo" && s.featured?.[0]) {
        slots[b][s.featured[0]] = "solo";
      } else if (s.kind === "trade" && s.featured?.length === 2) {
        const [horn, drums] = s.featured;
        const turn = Math.floor((b - s.start) / 2) % 2;
        slots[b][horn] = turn === 0 ? "solo" : "rest";
        slots[b][drums] = turn === 0 ? "groove" : "trade";
      }
    }
  }

  return {
    bars: total,
    meter: { beats },
    tempo: settings.tempo,
    key: settings.key,
    style: settings.style,
    standard: std?.id ?? null,
    sections,
    chords,
    leaderId,
    slots,
  };
}

export function sectionAt(frame: Frame, bar: number): Section {
  return (
    frame.sections.find((s) => bar >= s.start && bar < s.start + s.length) ??
    frame.sections[frame.sections.length - 1] ?? { name: "Head", kind: "head", start: 0, length: frame.bars }
  );
}

/** Human-readable chart summary used in prompts and the debug view. */
export function frameSummary(frame: Frame, members: Member[]): string {
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const lines: string[] = [];
  lines.push(`${frame.bars} bars of ${frame.meter.beats}/4, key ${frame.key.tonic} ${frame.key.mode}, ${frame.tempo} bpm.`);
  lines.push(`Leader: ${nameOf(frame.leaderId)}.`);
  for (const s of frame.sections) {
    lines.push(`Bars ${s.start + 1}-${s.start + s.length}: ${s.name}`);
  }
  lines.push(
    "Chords: " +
      frame.chords.map((c, i) => `${i + 1}:${c.map((x) => x.symbol).join(" ")}`).join(" | "),
  );
  return lines.join("\n");
}
