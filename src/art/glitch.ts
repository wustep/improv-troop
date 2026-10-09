import type { Pt } from "./affine";
import { ANCHOR } from "./animals";

// What looks wrong in a drawn frame. Used by the art lab's scrubber (to stop on a bad frame) and
// by the rig tests (so a take never shows one).

export type Glitch = "crossed" | "jump";

/** A paw that moves farther than this in one 60 fps frame reads as a teleport, not a motion. */
export const JUMP_PX = 25;

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

/**
 * Arms that cross in front of the body (the shoulder-to-paw lines intersect away from the
 * shoulders; a paw merely right of the other, as on a slanted clarinet, is fine), or a paw that
 * moved too far since the previous frame.
 */
export function glitchesOf(now: Record<"L" | "R", Pt>, prev: Record<"L" | "R", Pt> | null): Glitch[] {
  const out: Glitch[] = [];
  const x = crossing(ANCHOR.shoulderL, now.L, ANCHOR.shoulderR, now.R);
  if (x && Math.min(Math.hypot(x.x - ANCHOR.shoulderL.x, x.y - ANCHOR.shoulderL.y), Math.hypot(x.x - ANCHOR.shoulderR.x, x.y - ANCHOR.shoulderR.y)) > NEAR_SHOULDER) out.push("crossed");
  if (prev && Math.max(Math.hypot(now.L.x - prev.L.x, now.L.y - prev.L.y), Math.hypot(now.R.x - prev.R.x, now.R.y - prev.R.y)) > JUMP_PX) out.push("jump");
  return out;
}
