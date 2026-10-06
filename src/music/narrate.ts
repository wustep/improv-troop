// Band talk for local takes. With no model to ask, the band still says what it's about to do,
// read straight off the frame and the plan, so the lines always match the music: who counts it
// off, whose chorus it is, how a solo opens up the motif, where the band drops out, how it ends.

import { ENDINGS } from "./ending";
import { INSTRUMENTS } from "./instruments";
import type { Rng } from "./rng";
import type { BarPlan, ChatMessage, Frame, Member, Section } from "./types";

const OPENERS: Record<string, string[]> = {
  invert: ["I'll turn that little tune upside down.", "Same tune, flipped over."],
  up: ["I'll take the tune up a step and see where it goes.", "Starting from the tune, a little higher."],
  down: ["I'll answer it a step down.", "Starting from the tune, a little lower."],
  rhythm: ["Same notes, new rhythm.", "I'll keep the notes and move them around."],
  displace: ["I'll start it late, off the beat.", "Same tune, pushed off the beat."],
  frag: ["Just the first few notes of it, over and over.", "I'll chew on a piece of the tune."],
  retro: ["I'm playing the tune backwards.", "Backwards, from the last note in."],
  aug: ["I'll stretch it out, nice and slow.", "Same tune, twice as long."],
  seq: ["I'll walk the tune down step by step.", "Same tune, a step lower each time."],
  ornament: ["I'll dress the tune up a little.", "Same tune, with some curls on it."],
};

const SOLO_PLAIN = ["My chorus.", "Let me take this one.", "My turn."];
const HEAD = ["Here's the tune.", "This is how it goes.", "Listen to this one."];
const OUT = ["Back to the tune.", "Taking it home.", "One more time through the tune."];
const TAG = ["Again, the last bit!", "Once more…"];
const VAMP = ["Vamp till ready.", "Just the groove for a bit."];
const STOPTIME = ["Everybody hit the one and lay out.", "Stop-time: hit and wait."];
const BREAKDOWN = ["Just bass and drums for a bit.", "Breakdown: everyone else, sit out."];
const ENDING_LINES: Record<string, string[]> = {
  ring: ["Hold it… hold it…", "Let it ring!"],
  button: ["And… stop.", "Hit it and stop."],
  fade: ["Let it fade away.", "Soft now, let it ring away."],
  cadence: ["Slow down into the last chord.", "Broaden… and rest."],
};

const keyName = (f: Frame) => `${f.key.tonic} ${f.key.mode === "minor" ? "minor" : "major"}`;

/** The first motif transform a soloist's plan reaches for in a section ("invert", "up", "frag"…). */
function openerOf(plan: BarPlan[], s: Section, id: string): string | null {
  for (let b = s.start; b < Math.min(plan.length, s.start + s.length); b++) {
    const m = /^@motif\s+([a-z]+)/.exec(plan[b]?.directives?.[id] ?? "");
    if (m && OPENERS[m[1]]) return m[1];
  }
  return null;
}

export function narrateLocal(frame: Frame, plan: BarPlan[], members: Member[], rng: Rng): ChatMessage[] {
  const out: ChatMessage[] = [];
  const has = (id: string | undefined): id is string => !!id && members.some((m) => m.id === id);
  const say = (from: string, text: string, phase: ChatMessage["phase"], bar?: number, to?: string) => {
    if (out.some((c) => c.bar === bar && c.from === from && c.phase === phase)) return; // one line each per bar
    out.push({ id: `local-${out.length}`, from, text, phase, bar, to });
  };
  const leader = has(frame.leaderId) ? frame.leaderId : members[0]?.id;
  if (!leader) return out;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const byFn = (fn: string) => members.find((m) => INSTRUMENTS[m.instrument].fn === fn)?.id;
  const drummer = members.find((m) => m.instrument === "drums")?.id;
  const bassist = byFn("bass");

  const tempo = `${frame.tempo} bpm`;
  say(leader, rng.pick([`Counting it off: ${tempo}, ${keyName(frame)}.`, `${keyName(frame)}, ${tempo}. One, two…`]), "count-off", undefined, "band");

  for (const s of frame.sections) {
    const who = s.featured?.find(has);
    switch (s.kind) {
      case "head":
        if (s.start === 0) say(who ?? leader, rng.pick(HEAD), "jam", s.start);
        break;
      case "solo": {
        if (!who) break;
        const op = openerOf(plan, s, who);
        say(who, op ? rng.pick(OPENERS[op]) : rng.pick(SOLO_PLAIN), "jam", s.start);
        break;
      }
      case "trade": {
        const who = (s.featured ?? []).filter(has);
        const drums = who[who.length - 1];
        const horns = who.slice(0, -1);
        if (horns.length && drums)
          say(horns[0], `Trading ${s.turn ?? 2}s with ${nameOf(drums)}${horns.length > 1 ? `, ${horns.slice(1).map(nameOf).join(" and ")} after me` : ""}. You go after me.`, "jam", s.start, drums);
        break;
      }
      case "out":
        say(who ?? leader, rng.pick(OUT), "jam", s.start);
        break;
      case "tag":
        say(who ?? leader, rng.pick(TAG), "jam", s.start);
        break;
      case "intro":
      case "vamp": {
        const v = drummer ?? bassist ?? leader;
        say(v, rng.pick(VAMP), "jam", s.start);
        break;
      }
    }
  }

  // the first bar of each stop-time or breakdown passage
  for (let b = 0; b < plan.length; b++) {
    const t = plan[b].texture;
    if (t === plan[b - 1]?.texture) continue;
    if (t === "stoptime") say(drummer ?? leader, rng.pick(STOPTIME), "jam", b);
    else if (t === "breakdown" && (bassist || drummer)) say((bassist ?? drummer)!, rng.pick(BREAKDOWN), "jam", b);
  }

  const ending = ENDINGS[frame.style];
  const last = frame.bars - 1;
  if (ending && last > 0) say(leader, rng.pick(ENDING_LINES[ending.kind]), "jam", last);

  // count-off first, then in bar order (stable for lines in the same bar)
  return out
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (x.c.bar ?? -1) - (y.c.bar ?? -1) || x.i - y.i)
    .map(({ c }, i) => ({ ...c, id: `local-${i}` }));
}
