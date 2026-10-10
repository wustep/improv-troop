import { FrameComputer } from "@/components/stage/frames";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { STYLES } from "@/music/styles";
import type { InstrumentId, Member, Score, StyleId } from "@/music/types";

export interface RigTake {
  score: Score;
  /** The member playing the instrument. */
  id: string;
  spb: number;
  /** Length of the take in beats. */
  beats: number;
  frames: FrameComputer;
}

/**
 * A real take for one instrument, the way the stage plays it: the default band (plus a guest on
 * this instrument when nobody in it plays one) and the local engine. Drives the rig tests and the
 * art lab's style mode.
 */
export function rigTake(inst: InstrumentId, style: StyleId, opts: { seed?: number; solo?: boolean; tempo?: number } = {}): RigTake {
  const band: Member[] = defaultMembers();
  if (!band.some((m) => m.instrument === inst)) band.push({ id: "guest", animal: "cat", name: "Guest", instrument: inst });
  const id = band.find((m) => m.instrument === inst)!.id;
  const st = STYLES[style];
  const tempo = opts.tempo ?? st.tempo.default;
  const { score } = generateLocal({ ...defaultSettings(band), style, tempo, key: { ...st.key }, seed: opts.seed ?? 3, ...(opts.solo ? { soloists: [id] } : {}) }, band);
  return { score, id, spb: 60 / score.frame.tempo, beats: score.frame.bars * score.frame.meter.beats, frames: new FrameComputer(score) };
}
