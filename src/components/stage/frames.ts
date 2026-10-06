import { applyFeel } from "@/audio/feel";
import { DYNAMIC_ENERGY } from "@/music/context";
import { INSTRUMENTS } from "@/music/instruments";
import { isFeaturedRole } from "@/music/realize";
import type { ActiveNote, MemberFrameState, NoteEvent, OnsetInfo, Score, UpcomingOnset } from "@/music/types";

// Turns the score + playhead into per-member animation state every frame.
// Notes are pre-sorted with their *felt* (swung) times so motion lines up with what you hear,
// and shaped the way the audio engine plays them (staccato cut short, pizz capped, pitches
// folded into the instrument's range), so a key stays down exactly as long as it sounds.

/** How far ahead rigs can see (seconds): enough for a stick or hand to wind up. */
const LOOKAHEAD_SEC = 0.6;

interface Track {
  start: Float64Array; // felt start, beats
  end: Float64Array; // felt end, beats
  pitch: Int16Array;
  vel: Float32Array;
  art: (NoteEvent["art"] | undefined)[];
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
        art: new Array(n),
        maxDur: 0,
      };
      const spb = 60 / (score.frame.tempo || 120);
      const range = m.instrument === "drums" ? null : INSTRUMENTS[m.instrument]?.range;
      notes.forEach((x, i) => {
        const s = applyFeel(x.start, score.swing);
        let e = Math.max(s + 0.05, applyFeel(x.start + x.dur, score.swing));
        // mirror the audio engine's articulation lengths
        if (x.art === "staccato") e = s + Math.max(0.05, (e - s) * 0.5);
        if (x.art === "pizz") e = Math.min(e, s + 0.9 / spb);
        let p = Math.round(x.pitch);
        if (range) {
          while (p < range[0] - 12) p += 12;
          while (p > range[1] + 12) p -= 12;
        }
        t.start[i] = s;
        t.end[i] = e;
        t.pitch[i] = p;
        t.vel[i] = x.vel;
        t.art[i] = x.art;
        t.maxDur = Math.max(t.maxDur, e - s);
      });
      this.tracks.set(m.id, t);
    }
  }

  /** Screen-relative direction from this member to whoever is featured in `bar`. */
  private lookX(memberId: string, bar: number): number {
    const ms = this.score.members;
    const bp = this.score.plan[bar];
    if (!bp || ms.length < 2) return 0;
    const i = ms.findIndex((m) => m.id === memberId);
    const j = ms.findIndex((m) => isFeaturedRole(bp.roles[m.id]) && m.instrument !== "drums");
    const jj = j >= 0 ? j : ms.findIndex((m) => isFeaturedRole(bp.roles[m.id]));
    if (i < 0 || jj < 0 || jj === i) return 0;
    return Math.max(-1, Math.min(1, (jj - i) / (ms.length - 1)));
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
      lookX: this.lookX(memberId, bar),
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
        active.push({ pitch: t.pitch[j], vel: t.vel[j], age: (beat - s) * spb, progress: Math.min(1, (beat - s) / (t.end[j] - s)), durSec, art: t.art[j] });
      }
      if (recent.length < 6) recent.push({ pitch: t.pitch[j], vel: t.vel[j], age: (beat - s) * spb, art: t.art[j] });
      if (active.length > 12) break;
    }
    const nx = i + 1 < t.start.length ? i + 1 : -1;
    base.active = active;
    base.recent = recent;
    if (nx >= 0) {
      base.nextOnsetIn = (t.start[nx] - beat) * spb;
      base.nextPitch = t.pitch[nx];
    }
    const upcoming: UpcomingOnset[] = [];
    for (let j = nx; j >= 0 && j < t.start.length && upcoming.length < 16; j++) {
      const inSec = (t.start[j] - beat) * spb;
      if (inSec > LOOKAHEAD_SEC) break;
      upcoming.push({ pitch: t.pitch[j], vel: t.vel[j], inSec, art: t.art[j] });
    }
    base.upcoming = upcoming;
    return base;
  }
}
