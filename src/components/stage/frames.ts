import { applyFeel } from "@/audio/feel";
import { DYNAMIC_ENERGY } from "@/music/context";
import { isFeaturedRole } from "@/music/realize";
import type { ActiveNote, MemberFrameState, OnsetInfo, Score } from "@/music/types";

// Turns the score + playhead into per-member animation state every frame.
// Notes are pre-sorted with their *felt* (swung) times so motion lines up with what you hear.

interface Track {
  start: Float64Array; // felt start, beats
  end: Float64Array; // felt end, beats
  pitch: Int16Array;
  vel: Float32Array;
  maxDur: number;
}

export class FrameComputer {
  private tracks = new Map<string, Track>();
  constructor(public score: Score) {
    for (const m of score.members) {
      const notes = [...(score.parts[m.id] ?? [])].sort((a, b) => a.start - b.start);
      const n = notes.length;
      const t: Track = {
        start: new Float64Array(n),
        end: new Float64Array(n),
        pitch: new Int16Array(n),
        vel: new Float32Array(n),
        maxDur: 0,
      };
      notes.forEach((x, i) => {
        const s = applyFeel(x.start, score.swing);
        const e = Math.max(s + 0.05, applyFeel(x.start + x.dur, score.swing));
        t.start[i] = s;
        t.end[i] = e;
        t.pitch[i] = x.pitch;
        t.vel[i] = x.vel;
        t.maxDur = Math.max(t.maxDur, e - s);
      });
      this.tracks.set(m.id, t);
    }
  }

  /** Index of the last note starting at or before `beat` (or -1). */
  private lastStarted(t: Track, beat: number): number {
    let lo = 0;
    let hi = t.start.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t.start[mid] <= beat) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  compute(memberId: string, beat: number, playing: boolean, spb: number): MemberFrameState {
    const score = this.score;
    const beats = score.frame.meter.beats;
    const bpm = score.frame.tempo;
    const bar = Math.max(0, Math.min(score.frame.bars - 1, Math.floor(beat / beats)));
    const bp = score.plan[bar];
    const role = bp?.roles[memberId] ?? "rest";
    const base: MemberFrameState = {
      playing,
      beat,
      beatPhase: ((beat % 1) + 1) % 1,
      bpm,
      beatsPerBar: beats,
      active: [],
      recent: [],
      nextOnsetIn: Infinity,
      nextPitch: null,
      role,
      energy: DYNAMIC_ENERGY[bp?.dynamic ?? "mf"],
      featured: isFeaturedRole(role),
    };
    const t = this.tracks.get(memberId);
    if (!t || !playing || !Number.isFinite(beat)) return base;

    const i = this.lastStarted(t, beat);
    const active: ActiveNote[] = [];
    const recent: OnsetInfo[] = [];
    for (let j = i; j >= 0; j--) {
      const s = t.start[j];
      if (beat - s > t.maxDur + 0.01 && recent.length >= 6) break;
      if (t.end[j] > beat) {
        const durSec = (t.end[j] - s) * spb;
        active.push({ pitch: t.pitch[j], vel: t.vel[j], age: (beat - s) * spb, progress: Math.min(1, (beat - s) / (t.end[j] - s)), durSec });
      }
      if (recent.length < 6) recent.push({ pitch: t.pitch[j], vel: t.vel[j], age: (beat - s) * spb });
      if (active.length > 12) break;
    }
    const nx = i + 1 < t.start.length ? i + 1 : -1;
    base.active = active;
    base.recent = recent;
    if (nx >= 0) {
      base.nextOnsetIn = (t.start[nx] - beat) * spb;
      base.nextPitch = t.pitch[nx];
    }
    return base;
  }
}
