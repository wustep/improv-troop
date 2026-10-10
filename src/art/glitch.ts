import type { Pt } from "./affine";
import { ANCHOR } from "./animals";

// What looks wrong in a drawn frame. Used by the art lab's scrubber (to stop on a bad frame) and
// by the rig tests (so a take never shows one).

/**
 * crossed: the arms cross each other. jump: a paw teleports. reach: an arm stretched longer than
 * an arm could be. across: an arm laid straight across the chest to the far side.
 */
export type Glitch = "crossed" | "jump" | "reach" | "across";

/** A paw that moves farther than this in one 60 fps frame reads as a teleport, not a motion. */
export const JUMP_PX = 25;

/**
 * Farther than this from its shoulder, a paw is out of reach: the arm turns into a noodle. The
 * shoulders are 58 apart; a resting arm hangs about 45.
 */
export const REACH_PX = 88;

/** A paw this far past the other shoulder, at chest height, has its arm laid across the chest. */
export const ACROSS_PX = 8;

/**
 * The chest band, relative to shoulder height: from the chin to the upper belly. Lower down an
 * arm can come across the body naturally (a bassist's pizz, a guitarist's strum, the sax's
 * lower stack); higher up it's a reach over the head.
 */
const CHEST_ABOVE = 45;
const CHEST_BELOW = 25;

/** Where segments ab and cd cross, if they do. */
function crossing(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (den === 0) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } : null;
}

/** An arm passing just in front of the other shoulder (a sax held at the side) is a normal hold. */
const NEAR_SHOULDER = 16;

/** How far past the far shoulder a paw is, at chest height (≤ 0: not across). */
export function acrossBy(side: "L" | "R", paw: Pt, sh: Record<"L" | "R", Pt>): number {
  const own = sh[side];
  if (paw.y < own.y - CHEST_ABOVE || paw.y > own.y + CHEST_BELOW) return 0;
  return side === "L" ? paw.x - sh.R.x : sh.L.x - paw.x;
}

/**
 * Arms that cross in front of the body (the shoulder-to-paw lines intersect away from the
 * shoulders; a paw merely right of the other, as on a slanted clarinet, is fine), a paw that
 * moved too far since the previous frame, one out of the arm's reach, or one past the far
 * shoulder at chest height.
 */
export function glitchesOf(
  now: Record<"L" | "R", Pt>,
  prev: Record<"L" | "R", Pt> | null,
  sh: Record<"L" | "R", Pt> = { L: ANCHOR.shoulderL, R: ANCHOR.shoulderR },
): Glitch[] {
  const out: Glitch[] = [];
  const x = crossing(sh.L, now.L, sh.R, now.R);
  if (x && Math.min(Math.hypot(x.x - sh.L.x, x.y - sh.L.y), Math.hypot(x.x - sh.R.x, x.y - sh.R.y)) > NEAR_SHOULDER) out.push("crossed");
  if (prev && Math.max(Math.hypot(now.L.x - prev.L.x, now.L.y - prev.L.y), Math.hypot(now.R.x - prev.R.x, now.R.y - prev.R.y)) > JUMP_PX) out.push("jump");
  if (Math.max(Math.hypot(now.L.x - sh.L.x, now.L.y - sh.L.y), Math.hypot(now.R.x - sh.R.x, now.R.y - sh.R.y)) > REACH_PX) out.push("reach");
  if (Math.max(acrossBy("L", now.L, sh), acrossBy("R", now.R, sh)) > ACROSS_PX) out.push("across");
  return out;
}
