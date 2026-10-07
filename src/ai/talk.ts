import { parseChord, type ChordQuality } from "@/music/theory";
import type { ChatMessage, Frame } from "@/music/types";

// What the band says out loud, checked before it reaches the speech bubbles. Measured on the
// gateway: Haiku bandmates spoke on every phrase, mostly re-saying the same few words
// ("pocket", "motif", "locked"), and leaders named chords the chart doesn't have.

const FAMILY: Record<ChordQuality, string> = {
  maj: "maj",
  maj7: "maj",
  "6": "maj",
  power: "maj",
  min: "min",
  min7: "min",
  m6: "min",
  minMaj7: "min",
  dom: "dom",
  sus: "sus",
  m7b5: "half",
  dim: "dim",
  dim7: "dim",
  aug: "aug",
};

// A chord name in prose needs a quality ("G7", "Cm7", "Bbmaj7"): a bare letter is a note or a word.
const NAMED = /(?<![\w#])([A-G][b#]?)(maj7|maj9|maj|M7|m7b5|m7|m9|m6|m11|min7|min|m|7sus4|7sus|sus4|sus|dim7|dim|aug|ø7?|°7?|13|11|9|7|6)(?![\w#])/g;

function famOf(symbol: string) {
  const c = parseChord(symbol);
  return { root: c.root, fam: FAMILY[c.quality] ?? c.quality };
}

/**
 * Chord names checked against the chart: a real root with the wrong quality ("C7" over a chart
 * with Cm7) becomes the chart's chord; a sentence naming a chord the chart never plays goes.
 * Returns null when nothing is left.
 */
export function checkChordNames(line: string, frame: Frame): string | null {
  const chart = frame.chords.flat().map((c) => ({ symbol: c.symbol, ...famOf(c.symbol) }));
  const sentences = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
  const kept = sentences
    .map((s) => {
      let bogus = false;
      const fixed = s.replace(NAMED, (whole) => {
        const { root, fam } = famOf(whole);
        const same = chart.filter((c) => c.root === root);
        if (!same.length) {
          bogus = true;
          return whole;
        }
        const ok = same.some((c) => c.fam === fam || (fam === "sus" && (c.fam === "dom" || c.fam === "maj")));
        return ok ? whole : same[0].symbol;
      });
      return bogus ? "" : fixed;
    })
    .join("")
    .trim();
  return kept || null;
}

const STOP = new Set(
  "a an the and or but so to of in on at for with into onto from up down out over under is are am be been i i'm i'll im ill we we're let's lets you your you're it it's its that this those these there here my me our us just now then all some more as by off back on got get go going gonna keep keeping let ready yeah ok okay".split(
    " ",
  ),
);
// Bandstand filler the models lean on: alone, these say nothing about the music.
const STOCK = new Set("pocket motif locked lock locking tight steady clean groove groovin vibe vibes feel feeling solid riding ride shape breathe breathing landing land".split(" "));

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9'#\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w));

/**
 * Who gets to talk. The jam has a budget of lines, paced across its phrases so the talk doesn't
 * all land in the first half; a phrase holds two lines at most; a player who isn't featured
 * speaks at most every other phrase; a line whose words are mostly bandstand filler or already
 * said in the last few lines is dropped.
 */
export class TalkGate {
  private lastSpoke = new Map<string, number>();
  private perPhrase = new Map<number, number>();
  private used = 0;
  private phrases: number;
  readonly budget: number;
  constructor(
    private frame: Frame,
    private phraseBars: number,
  ) {
    this.phrases = Math.max(1, Math.ceil(frame.bars / phraseBars));
    this.budget = Math.min(10, Math.max(4, Math.round(this.phrases * 1.25)));
  }

  /** The line as it should be said, or null to stay quiet. */
  allow(speaker: string, line: string, bar: number, featured: boolean, chat: ChatMessage[]): string | null {
    const phrase = Math.floor(bar / this.phraseBars);
    if ((this.perPhrase.get(phrase) ?? 0) >= 2) return null;
    // by the end of this phrase, at most its share of the budget (what earlier phrases left unsaid carries over)
    if (this.used >= Math.ceil((this.budget * (phrase + 1)) / this.phrases)) return null;
    const last = this.lastSpoke.get(speaker);
    // phrases are answered a little out of order (the next soloist thinks while the band answers)
    if (!featured && last !== undefined && Math.abs(phrase - last) < 2) return null;
    const checked = checkChordNames(line, this.frame);
    if (!checked) return null;
    if (isFiller(checked, chat.filter((c) => c.phase !== "count-off"))) return null;
    this.used++;
    this.perPhrase.set(phrase, (this.perPhrase.get(phrase) ?? 0) + 1);
    this.lastSpoke.set(speaker, phrase);
    return checked;
  }
}

/** Band talk kept in bar order: a line for an earlier bar that arrives late goes before later bars. */
export function insertByBar(chat: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (msg.bar === undefined) return [...chat, msg];
  let i = chat.length;
  while (i > 0 && chat[i - 1].bar !== undefined && chat[i - 1].bar! > msg.bar) i--;
  return [...chat.slice(0, i), msg, ...chat.slice(i)];
}

/** Mostly stock words, or mostly words the band said in its last few lines. */
export function isFiller(line: string, chat: ChatMessage[], recent = 6): boolean {
  const w = words(line);
  if (w.length < 3) return false;
  const said = new Set(chat.slice(-recent).flatMap((c) => words(c.text)));
  const stale = w.filter((x) => STOCK.has(x) || said.has(x)).length;
  return stale / w.length >= 0.55;
}
