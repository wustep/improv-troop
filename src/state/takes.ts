import { ANIMALS, INSTRUMENTS } from "@/music/instruments";
import type { Score } from "@/music/types";

export interface Take {
  id: string;
  score: Score;
  label: string;
  engine: "local" | "ai";
  createdAt: number;
}

/** How many takes the list keeps: the same number on screen and after a reload. */
export const MAX_TAKES = 12;

const LS_TAKES = "jamming:takes:v1";

/** A new take on top (replacing an older copy of the same chart), trimmed to the cap. */
export function addTake(takes: Take[], take: Take): Take[] {
  return [take, ...takes.filter((t) => t.id !== take.id)].slice(0, MAX_TAKES);
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
