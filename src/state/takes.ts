import { ANIMALS, INSTRUMENTS } from "@/music/instruments";
import { realize } from "@/music/realize";
import type { Score } from "@/music/types";

export interface Take {
  id: string;
  score: Score;
  label: string;
  engine: "local" | "ai";
  createdAt: number;
  /** A jam saved while it was still being played: the band had finished this many bars. */
  cutAt?: number;
}

/** How many takes the list keeps: the same number on screen and after a reload. */
export const MAX_TAKES = 12;

const LS_TAKES = "jamming:takes:v1";

/** A new take on top (replacing an older copy of the same chart), trimmed to the cap. */
export function addTake(takes: Take[], take: Take): Take[] {
  return [take, ...takes.filter((t) => t.id !== take.id)].slice(0, MAX_TAKES);
}

/**
 * A jam in progress, saved so a reload brings it back with the band's real talk. The bars the
 * band hadn't finished are played from the same plan and motif, the way autopilot would have.
 */
export function cutShortTake(score: Score, readyBars: number, label: string): Take {
  const rest = Array.from({ length: Math.max(0, score.frame.bars - readyBars) }, (_, i) => readyBars + i);
  const filled = rest.length
    ? realize({ frame: score.frame, members: score.members, plan: score.plan, motif: score.motif, seed: score.settings.seed, bars: rest }).parts
    : {};
  const parts = Object.fromEntries(
    Object.entries(score.parts).map(([id, notes]) => [id, [...notes, ...(filled[id] ?? [])].sort((a, b) => a.start - b.start)]),
  );
  const notes = [...score.notes.filter((n) => n !== "(still jamming…)"), ...(rest.length ? [`Cut short after bar ${readyBars}: the band's engine played the rest from the same plan.`] : [])];
  return { id: score.id, score: { ...score, parts, notes }, label: `${label} (cut short)`, engine: "ai", createdAt: score.createdAt, cutAt: readyBars };
}

function isTake(t: unknown): t is Take {
  const take = t as Take | null;
  return (
    typeof take?.id === "string" &&
    typeof take.label === "string" &&
    typeof take.createdAt === "number" &&
    !!take.score?.frame &&
    !!take.score.parts &&
    Array.isArray(take.score.members) &&
    take.score.members.every((m) => ANIMALS[m?.animal] && INSTRUMENTS[m?.instrument])
  );
}

export function loadTakes(): Take[] {
  try {
    const raw = localStorage.getItem(LS_TAKES);
    const takes: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(takes) ? takes.filter(isTake).slice(0, MAX_TAKES) : [];
  } catch {
    return [];
  }
}

export function saveTakes(takes: Take[]) {
  // over quota: keep as many of the newest as fit
  for (const n of [MAX_TAKES, 8, 3]) {
    try {
      localStorage.setItem(LS_TAKES, JSON.stringify(takes.slice(0, n)));
      return;
    } catch {
      /* try fewer */
    }
  }
}
