// Share a local take as a link. A local take is fully determined by its settings, its band and
// its seed (see generateLocal), so the link carries only those and the receiving page plays it
// again. Model-written takes can't be rebuilt from a seed, so they aren't shareable this way.
//
// Format: `#t=1.<base64url JSON>`. The leading number versions the payload; the music engine
// itself isn't versioned, so an old link replays with whatever the band plays today.

import { ANIMALS, INSTRUMENTS } from "@/music/instruments";
import { getStandard } from "@/music/standards";
import { STYLES } from "@/music/styles";
import type { AnimalId, InstrumentId, Member, Score, StyleId, TroopSettings } from "@/music/types";

const VERSION = 1;
export const SHARE_PARAM = "t";
const MAX_MEMBERS = 12;

type SharedSettings = Pick<TroopSettings, "style" | "bars" | "tempo" | "key" | "meter" | "standard" | "leaderId" | "soloists" | "seed" | "phraseBars" | "swingFeel">;

interface Payload {
  s: SharedSettings;
  m: [id: string, animal: string, name: string, instrument: string][];
}

export interface SharedTake {
  settings: SharedSettings;
  members: Member[];
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function canShare(score: Score | null): score is Score {
  return !!score && score.engine === "local";
}

/** The hash value (without `#t=`) for a local take. */
export function encodeShare(score: Score): string {
  const s = score.settings;
  const payload: Payload = {
    s: {
      style: s.style,
      bars: s.bars,
      tempo: s.tempo,
      key: s.key,
      meter: s.meter,
      standard: s.standard,
      leaderId: s.leaderId,
      soloists: s.soloists,
      seed: s.seed,
      phraseBars: s.phraseBars,
      ...(s.swingFeel && s.swingFeel !== "medium" ? { swingFeel: s.swingFeel } : {}),
    },
    m: score.members.map((m) => [m.id, m.animal, m.name, m.instrument]),
  };
  return `${VERSION}.${toBase64Url(JSON.stringify(payload))}`;
}

const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/**
 * Read a shared take. Everything in a link is untrusted, so every field is checked or clamped
 * and anything unknown (a style, animal or instrument this build doesn't have) rejects the link.
 */
export function decodeShare(value: string): SharedTake | null {
  const m = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(value.trim());
  if (!m || +m[1] !== VERSION) return null;
  let p: Payload;
  try {
    p = JSON.parse(fromBase64Url(m[2]));
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || !p.s || !Array.isArray(p.m)) return null;

  const members: Member[] = [];
  for (const row of p.m.slice(0, MAX_MEMBERS)) {
    if (!Array.isArray(row)) return null;
    const [id, animal, name, instrument] = row;
    if (!str(id, 40) || !str(name, 24)) return null;
    if (!Object.hasOwn(ANIMALS, animal) || !Object.hasOwn(INSTRUMENTS, instrument)) return null;
    if (members.some((x) => x.id === id)) return null;
    members.push({ id, name, animal: animal as AnimalId, instrument: instrument as InstrumentId });
  }
  if (!members.length) return null;

  const s = p.s;
  if (!Object.hasOwn(STYLES, s.style)) return null;
  const style = STYLES[s.style as StyleId];
  const standard = s.standard === null || s.standard === undefined ? null : getStandard(s.standard) ? s.standard : undefined;
  if (standard === undefined) return null;
  const tonic = typeof s.key?.tonic === "string" && /^[A-G][b#]?$/.test(s.key.tonic) ? s.key.tonic : null;
  const mode = s.key?.mode === "major" || s.key?.mode === "minor" ? s.key.mode : null;
  const bars = int(s.bars, 4, 256);
  const tempo = int(s.tempo, 30, 320);
  const beats = int(s.meter?.beats, 2, 7);
  const seed = int(s.seed, 0, 2 ** 32 - 1);
  if (!tonic || !mode || bars === null || tempo === null || beats === null || seed === null) return null;
  const ids = new Set(members.map((x) => x.id));

  return {
    members,
    settings: {
      style: style.id,
      standard,
      bars,
      tempo,
      key: { tonic, mode },
      meter: { beats },
      seed,
      leaderId: typeof s.leaderId === "string" && ids.has(s.leaderId) ? s.leaderId : "",
      soloists: Array.isArray(s.soloists) ? s.soloists.filter((id): id is string => typeof id === "string" && ids.has(id)) : [],
      phraseBars: int(s.phraseBars, 1, 16) ?? 4,
      ...(s.swingFeel === "light" || s.swingFeel === "hard" ? { swingFeel: s.swingFeel } : {}),
    },
  };
}

/** Pull a shared take out of a location hash like `#t=1.eyJ…`. */
export function sharedFromHash(hash: string): SharedTake | null {
  const v = new URLSearchParams(hash.replace(/^#/, "")).get(SHARE_PARAM);
  return v ? decodeShare(v) : null;
}

export function shareUrl(score: Score, base: string): string {
  const url = new URL(base);
  url.hash = `${SHARE_PARAM}=${encodeShare(score)}`;
  return url.toString();
}
