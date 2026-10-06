import { reharmonize } from "./reharm";
import { INSTRUMENTS } from "./instruments";
import { makeRng } from "./rng";
import { getStandard } from "./standards";
import { STYLES } from "./styles";
import { mod, parseChord, pcOf, romanToChord, transposeChordSymbol, keyPrefersFlats } from "./theory";
import type { ChordChange, Frame, Member, Role, Section, TroopSettings } from "./types";

// Level 0 of the hierarchy: the locked frame. Length, form, harmony and the
// lead/solo slots are decided here in code; planners (local or model) only fill
// inside it and are never allowed to change the bar count.

export const FREE_LENGTHS = [8, 12, 16, 24, 32];

/** Styles whose bands count off into a rhythm-section intro before the head. */
const INTRO_STYLES = new Set<string>(["swing", "bossa", "neworleans", "pop", "funk"]);
/** Styles that end a standard with a tag (the turnaround played again before the last chord). */
const TAG_STYLES = new Set<string>(["swing", "neworleans"]);
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** A standard is played in whole choruses: up to six of them, and at most this many bars. */
const MAX_CHORUSES = 6;
const MAX_STANDARD_BARS = 160;

export function lengthOptions(standardId: string | null): number[] {
  const std = getStandard(standardId);
  if (!std) return FREE_LENGTHS;
  const len = std.bars.length;
  const out: number[] = [];
  for (let n = 1; n <= MAX_CHORUSES && n * len <= MAX_STANDARD_BARS; n++) out.push(n * len);
  return out.length ? out : [len];
}

/**
 * A full performance of a standard: the head, a chorus for each soloist (two to three of
 * them, as time allows), and the head out.
 */
export function defaultStandardLength(standardId: string | null, soloists = 1): number {
  const opts = lengthOptions(standardId);
  const std = getStandard(standardId);
  if (!std) return 16;
  const want = 2 + Math.min(3, Math.max(1, soloists));
  const fits = opts.filter((o) => o <= std.bars.length * want);
  return fits[fits.length - 1] ?? opts[0];
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
  // a baroque piece in minor ends on the major tonic (a Picardy third)
  if (style === "baroque") return t;
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

/** Head and out-head lengths for a free (non-standard) chart. */
function freeForm(total: number): { head: number; out: number } {
  if (total <= 8) return { head: 4, out: 0 };
  return { head: total >= 24 ? 8 : 4, out: total >= 12 ? (total >= 24 ? 8 : 4) : 0 };
}

interface SoloPlan {
  start: number;
  length: number;
  soloist: string;
}

function assignSolos(start: number, length: number, soloists: string[], unit: number): SoloPlan[] {
  if (!soloists.length || length <= 0) return [];
  // everyone gets an even turn: whole units of 4 (or 2) bars when they divide evenly, otherwise
  // as even a split as the bars allow (6 bars for two soloists is 3 and 3, not 4 and 2)
  const k = Math.min(soloists.length, length);
  const each = Math.floor(length / k / unit) * unit;
  const lens = each * k === length && each > 0 ? Array(k).fill(each) : Array.from({ length: k }, (_, i) => Math.floor(length / k) + (i < length % k ? 1 : 0));
  const out: SoloPlan[] = [];
  let t = start;
  lens.forEach((len, i) => {
    out.push({ start: t, length: len, soloist: soloists[i] });
    t += len;
  });
  return out;
}

/**
 * Solos on a standard go by the form, the way a band plays one: each soloist takes whole
 * choruses (the first soloists get any extra). With more soloists than choruses, choruses
 * split where the form does (the bridge, the second half) so nobody starts mid-phrase.
 */
/** Where a chorus splits in two: the form's section boundary nearest its middle. */
function formSplit(form: [string, number][], formLen: number): number {
  let acc = 0;
  let split = formLen / 2;
  for (const [, n] of form.slice(0, -1)) {
    acc += n;
    if (Math.abs(acc - formLen / 2) < Math.abs(split - formLen / 2) || split % 1) split = acc;
  }
  return split;
}

function assignChorusSolos(start: number, length: number, soloists: string[], formLen: number, form: [string, number][]): SoloPlan[] | null {
  if (!soloists.length || length <= 0 || length % formLen) return null;
  const choruses = length / formLen;
  const k = soloists.length;
  if (k <= choruses) {
    const out: SoloPlan[] = [];
    let t = start;
    soloists.forEach((soloist, i) => {
      const n = Math.floor(choruses / k) + (i < choruses % k ? 1 : 0);
      out.push({ start: t, length: n * formLen, soloist });
      t += n * formLen;
    });
    return out;
  }
  // split each chorus at the form's section boundary nearest its middle
  const split = formSplit(form, formLen);
  if (split <= 0 || split >= formLen || split % 1) return null;
  const halves: [number, number][] = [];
  for (let c = 0; c < choruses; c++) halves.push([start + c * formLen, split], [start + c * formLen + split, formLen - split]);
  if (k > halves.length) return null;
  const out: SoloPlan[] = [];
  let h = 0;
  soloists.forEach((soloist, i) => {
    const n = Math.floor(halves.length / k) + (i < halves.length % k ? 1 : 0);
    const mine = halves.slice(h, h + n);
    h += n;
    out.push({ start: mine[0][0], length: mine.reduce((sum, [, len]) => sum + len, 0), soloist });
  });
  return out;
}

export function buildFrame(input: TroopSettings, members: Member[]): Frame {
  const std = getStandard(input.standard);
  // a standard keeps its own mode (Autumn Leaves is minor in any key); only the tonic moves
  const settings = std ? { ...input, key: { ...input.key, mode: std.key.mode } } : input;
  const style = STYLES[settings.style];
  const beats = std ? std.meter : settings.meter.beats;
  const rng = makeRng(settings.seed).fork("frame");
  const requested = std ? snapLength(std.id, settings.bars) : Math.max(4, Math.round(settings.bars));
  // A real performance opens with a rhythm-section intro: a standard played two or more times
  // through, or a free chart of 16 bars or more. A standard adds the intro to its choruses; a
  // free chart keeps its length (the intro comes out of the solos).
  const intro = !INTRO_STYLES.has(settings.style) ? 0 : std ? (requested >= 2 * std.bars.length ? (std.bars.length >= 8 ? 4 : 2) : 0) : requested >= 24 ? 4 : requested >= 16 ? 2 : 0;
  const total = std ? requested : requested - intro;
  const flats = keyPrefersFlats(settings.key);

  // ── Harmony ──
  let barTexts: string[] = [];
  let tuneTail: string[] = []; // a free chart's closing bars, for its intro
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
    // a performance ends home: a form's last bar is usually its turnaround back to the top,
    // so it becomes the cadence into a final tonic bar (a blues ends Gm7 C7 | F, not on C7)
    const tonicPc = pcOf(settings.key.tonic);
    const last = barTexts[total - 1].split(/\s+/);
    const homeRoot = (sym: string) => parseChord(sym).root === tonicPc;
    if (!homeRoot(last[0])) {
      if (total >= 2) barTexts[total - 2] = barTexts[total - 1];
      barTexts[total - 1] = tonicChord(settings);
    } else if (last.length > 1) {
      barTexts[total - 1] = last[0];
    }
  } else {
    const prog = rng.pick(style.progressions[settings.key.mode]);
    const toText = (bar: string) =>
      bar
        .split(/\s+/)
        .map((tok) => romanToChord(tok, settings.key))
        .join(" ");
    // the tune: the progression with a light touch of the style's reharmonization, so each
    // take has its own changes (read with the top of the tune after it, where it turns around)
    const plain = prog.map(toText);
    const tune = reharmonize([...plain, plain[0]], 0, plain.length, () => 0.3, settings.key, settings.style, rng.fork("tune")).slice(0, plain.length);
    tuneTail = tune.slice(-4);
    barTexts = Array.from({ length: total }, (_, i) => tune[i % tune.length]);
    const { head, out } = freeForm(total);
    const outStart = out > 0 ? total - out : total;
    // solo choruses open the tune up, more each time around
    const soloEnd = out > 0 ? outStart - 1 : total - 2;
    barTexts = reharmonize(barTexts, head, soloEnd, (i) => 0.5 + 0.25 * Math.floor((i - head) / tune.length), settings.key, settings.style, rng.fork("solos"));
    if (out > 0) {
      // the out head is the head again: the same changes under the same melody,
      // and the bar before it turns the progression around into the top
      for (let i = 0; i < out; i++) barTexts[outStart + i] = barTexts[i];
      if (outStart - 1 >= head) barTexts[outStart - 1] = toText(prog[prog.length - 1]);
    }
    // cadence: the dominant into the tonic at the very end (keeping the bar's own first chord),
    // in the style's own color: a suspended V floats an ambient piece home, a plain triad ends a
    // pop song or a minimalist piece, everyone else leans on the V7
    if (total >= 4) {
      const first = barTexts[total - 2].split(/\s+/)[0];
      const plainV = settings.style === "ambient" ? romanToChord("Vsus", settings.key) : settings.style === "minimal" || settings.style === "pop" ? romanToChord("V", { ...settings.key, mode: "major" }) : null;
      const v7 = plainV ?? dominantOf(settings);
      barTexts[total - 2] = first === v7 ? v7 : `${first} ${v7}`;
    }
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
  // a pop band plays a chorus, takes a break, and comes back for the last chorus
  const words = settings.style === "pop" ? { head: "Chorus", out: "Last chorus", outHead: "Last chorus", solo: "Break" } : { head: "Head", out: "Out", outHead: "Out Head", solo: "Solo" };
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  const pushSolos = (start: number, length: number) => {
    const melodicSoloists = soloists.filter((s) => s !== drummer);
    const drumsSolo = !!drummer && soloists.includes(drummer);
    const horns = melodicSoloists.length ? melodicSoloists : [leaderId];
    const formLen = std?.bars.length ?? 0;
    // trading with the drummer: the last stretch of the solos, a chorus on a standard
    // when there's room for one (trading 4s), else the last few bars (2s)
    let tradeLen = 0;
    // a whole trading chorus only once every horn has a chorus of their own
    const wholeChorus = !!std && length % formLen === 0 && (length / formLen >= melodicSoloists.length + 1 || !melodicSoloists.length);
    if (drumsSolo) {
      tradeLen = wholeChorus ? formLen : Math.min(length, Math.max(4, Math.floor(length / (melodicSoloists.length + 1) / 2) * 2 || 4));
      if (!melodicSoloists.length) tradeLen = length;
    }
    // no room for a trading chorus on a standard: the horns keep whole choruses and the trade
    // takes the back half of the last one (where the form splits)
    const halfTrade = drumsSolo && !wholeChorus && !!std && melodicSoloists.length > 0 && length % formLen === 0;
    if (halfTrade) tradeLen = 0;
    const soloLen = length - tradeLen;
    if (soloLen > 0) {
      const who = melodicSoloists.length ? melodicSoloists : [leaderId];
      const plans = (std && assignChorusSolos(start, soloLen, who, formLen, std.form)) || assignSolos(start, soloLen, who, soloLen >= 8 ? 4 : 2);
      if (halfTrade && plans.length) {
        const last = plans[plans.length - 1];
        const split = formSplit(std!.form, formLen);
        const half = Math.min(last.length - 4, formLen - split);
        if (half >= 4) {
          last.length -= half;
          tradeLen = half;
        }
      }
      for (const p of plans) sections.push({ name: `${words.solo} · ${nameOf(p.soloist)}`, kind: "solo", start: p.start, length: p.length, featured: [p.soloist] });
    }
    if (tradeLen > 0) {
      const tStart = start + length - tradeLen;
      const turn = tradeLen >= 8 ? 4 : 2;
      // the horns take turns with the drummer: horn, drums, next horn, drums...
      const partners = tradeLen >= 3 * turn ? horns : [horns[horns.length - 1]];
      sections.push({
        name: `Trading ${turn}s · ${[...partners, drummer!].map(nameOf).join(" & ")}`,
        kind: "trade",
        start: tStart,
        length: tradeLen,
        featured: [...partners, drummer!],
        turn,
      });
    }
  };

  if (std) {
    const formLen = std.bars.length;
    const choruses = Math.max(1, Math.round(total / formLen));
    // Every performance comes back to the melody. With fewer than three choruses the
    // leader "takes it out" on the tune's last section (or last quarter) instead of
    // the tune ending in the middle of a solo.
    const lastSection = std.form.length > 1 ? std.form[std.form.length - 1][1] : Math.max(4, Math.floor(formLen / 4));
    if (choruses === 1) {
      if (soloists.length && formLen >= 16) {
        // AABA-style: head on the first sections, solo the bridge, take the last A out.
        // Two-part or through-composed tunes: head on the first half, solo, last quarter out.
        const sectioned = std.form.length > 2;
        const out = sectioned ? lastSection : Math.max(4, Math.floor(formLen / 4));
        const head = sectioned ? formLen - out - std.form[std.form.length - 2][1] : Math.floor(formLen / 2);
        sections.push({ name: words.head, kind: "head", start: 0, length: head, featured: [leaderId] });
        pushSolos(head, formLen - head - out);
        sections.push({ name: words.out, kind: "out", start: formLen - out, length: out, featured: [leaderId] });
      } else {
        sections.push({ name: words.head, kind: "head", start: 0, length: total, featured: [leaderId] });
      }
    } else {
      sections.push({ name: words.head, kind: "head", start: 0, length: formLen, featured: [leaderId] });
      const out = choruses >= 3 ? formLen : lastSection;
      pushSolos(formLen, total - formLen - out);
      sections.push({ name: choruses >= 3 ? words.outHead : words.out, kind: "out", start: total - out, length: out, featured: [leaderId] });
    }
  } else {
    const { head, out } = freeForm(total);
    const soloLen = total - head - out;
    sections.push({ name: words.head, kind: "head", start: 0, length: head, featured: [leaderId] });
    if (soloLen > 0) pushSolos(head, soloLen);
    if (out > 0) sections.push({ name: words.outHead, kind: "out", start: total - out, length: out, featured: [leaderId] });
  }
  // The tag: a swing or New Orleans standard played as a full performance doesn't resolve on
  // the out head's last bar. It swerves to iii (iii7 VI7 | ii7 V7), plays that turnaround
  // twice, and only then lands home, everyone in.
  const tag = std && TAG_STYLES.has(settings.style) && settings.key.mode === "major" && total >= 3 * std.bars.length ? 4 : 0;
  if (tag) {
    const tonic = barTexts[total - 1];
    const turn = [`${romanToChord("iii7", settings.key)} ${romanToChord("VI7", settings.key)}`, `${romanToChord("ii7", settings.key)} ${romanToChord("V7", settings.key)}`];
    chords.splice(total - 1, 1, ...[turn[0], turn[1], turn[0], turn[1], tonic].map((t) => splitBar(t, beats)));
    const last = sections[sections.length - 1];
    sections.push({ name: "Tag", kind: "tag", start: last.start + last.length, length: tag, featured: [leaderId] });
  }

  // The intro: the rhythm section plays the tune's last bars, turned around into the top,
  // before the head comes in.
  if (intro) {
    const introBars = std ? barTexts.slice(std.bars.length - intro, std.bars.length) : tuneTail.slice(-intro);
    // the last intro bar leads into the head's first chord with its dominant
    const target = parseChord(barTexts[0].split(/\s+/)[0]);
    const lastBar = introBars[intro - 1].split(/\s+/);
    const lead = parseChord(lastBar[lastBar.length - 1]);
    if (mod(lead.root - target.root, 12) !== 7 || (lead.quality !== "dom" && lead.quality !== "maj")) {
      const v7 = `${(flats ? FLAT_NAMES : SHARP_NAMES)[mod(target.root + 7, 12)]}7`;
      introBars[intro - 1] = lastBar[0] === v7 ? v7 : `${lastBar[0]} ${v7}`;
    }
    chords.unshift(...introBars.map((t) => splitBar(t, beats)));
    for (const sec of sections) sec.start += intro;
    sections.unshift({ name: "Intro", kind: "intro", start: 0, length: intro });
  }
  const bars = total + intro + tag;
  sections.sort((a, b) => a.start - b.start);

  // ── Locked slots ──
  const slots: Record<string, Role>[] = Array.from({ length: bars }, () => ({}));
  for (const s of sections) {
    for (let b = s.start; b < s.start + s.length; b++) {
      if (s.kind === "head" || s.kind === "out" || s.kind === "tag") {
        if (leaderId) slots[b][leaderId] = "lead";
      } else if (s.kind === "solo" && s.featured?.[0]) {
        slots[b][s.featured[0]] = "solo";
      } else if (s.kind === "trade" && s.featured && s.featured.length >= 2) {
        const horns = s.featured.slice(0, -1);
        const drums = s.featured[s.featured.length - 1];
        const turn = Math.floor((b - s.start) / (s.turn ?? 2));
        const hornUp = turn % 2 === 0 ? horns[(turn / 2) % horns.length] : null;
        for (const h of horns) slots[b][h] = h === hornUp ? "solo" : "rest";
        slots[b][drums] = hornUp ? "groove" : "trade";
        // the drummer's turn is a drum break: the whole band lays out for it
        if (!hornUp) for (const m of members) if (m.id !== drums) slots[b][m.id] = "rest";
      }
    }
  }

  return {
    bars,
    intro,
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
