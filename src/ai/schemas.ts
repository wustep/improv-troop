import type { JSONSchema7 } from "ai";

// JSON schemas for each kind of model call. Built per call so keys are concrete (member
// ids, bar numbers) — every property required and no extras, which strict structured-output
// providers demand. The tolerant parser and merge layer still validate everything.

const TEXTURES = ["sparse", "groove", "build", "peak", "breakdown", "tutti", "stoptime", "ostinato"];
const DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"];

const str = (description?: string): JSONSchema7 => ({ type: "string", ...(description ? { description } : {}) });

function obj(properties: Record<string, JSONSchema7>): JSONSchema7 {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

export function planSchema(memberIds: string[]): JSONSchema7 {
  return obj({
    concept: str("one sentence: the idea of this take"),
    motif: str("the shared cell in compact notes; 1 bar, or 2 separated by |"),
    motifIdea: str(),
    bars: {
      type: "array",
      description: "entries covering every bar exactly once, in order",
      items: obj({
        bars: str('a bar number like "7" or a range like "5-8"'),
        texture: { type: "string", enum: TEXTURES },
        dynamic: { type: "string", enum: DYNAMICS },
        cue: str("short note, may be empty"),
        parts: obj(Object.fromEntries(memberIds.map((id) => [id, str("directive, compact notes, or drum grid")]))),
      }),
    },
  });
}

export function criticSchema(): JSONSchema7 {
  return obj({
    scores: {
      type: "array",
      items: obj({
        candidate: { type: "integer" },
        distinctiveness: { type: "number" },
        coherence: { type: "number" },
        note: str(),
      }),
    },
    best: { type: "integer" },
    summary: str(),
  });
}

/**
 * {"bars": {"5": "...", ...}, "say": "..."} — bar numbers are 1-based. With `count`, each bar's
 * rhythm summed in beats comes first ({"count": {"5": "1 + ½ + ½ + 1 + 1 = 4"}, ...}), so a groove's
 * beats are added up before its notes are written.
 */
export function barsSchema(barNumbers: number[], withSay: boolean, count = false): JSONSchema7 {
  const perBar = (description?: string) => obj(Object.fromEntries(barNumbers.map((b) => [String(b), str(description)])));
  const bars = perBar();
  return obj({
    ...(count ? { count: perBar('beats of each note and rest, summed, e.g. "1 + ½ + ½ + 1 + 1 = 4"; "-" for a directive') } : {}),
    bars,
    ...(withSay ? { say: str("short line to the band, or empty") } : {}),
  });
}

export function countOffSchema(otherIds: string[]): JSONSchema7 {
  return obj({
    say: str(),
    motif: str("compact notes, 1 bar or 2 separated by |"),
    motifIdea: str(),
    arc: {
      type: "array",
      items: obj({ bars: str('"1-4"'), texture: { type: "string", enum: TEXTURES }, dynamic: { type: "string", enum: DYNAMICS } }),
    },
    asks: obj(Object.fromEntries(otherIds.map((id) => [id, str()]))),
  });
}

export function replySchema(): JSONSchema7 {
  return obj({ say: str(), default: str("an accompaniment directive like @walk or @comp sparse") });
}
