import { mod, type Chord } from "../theory";

export type VoicingFamily = "rootless" | "triad" | "open" | "quartal" | "shell";

function rootlessForms(c: Chord): number[][] {
  const alt9 = c.tensions.includes(13) ? 13 : c.tensions.includes(15) ? 15 : 14;
  switch (c.quality) {
    case "maj7":
      return [
        [4, 7, 11, 14],
        [11, 14, 16, 19],
      ];
    case "6":
    case "maj":
      return [
        [4, 7, 9, 14],
        [9, 14, 16, 19],
      ];
    case "min7":
    case "min":
      return [
        [3, 7, 10, 14],
        [10, 14, 15, 19],
      ];
    case "m6":
      return [
        [3, 7, 9, 14],
        [9, 14, 15, 19],
      ];
    case "minMaj7":
      return [[3, 7, 11, 14]];
    case "dom":
      return [
        [4, 9, 10, alt9],
        [10, alt9, 16, 21],
      ];
    case "sus":
      return [
        [5, 7, 10, 14],
        [10, 14, 17, 19],
      ];
    case "m7b5":
      return [
        [3, 6, 10, 12],
        [10, 12, 15, 18],
      ];
    case "dim7":
    case "dim":
      return [[3, 6, 9, 12]];
    case "aug":
      return [[4, 8, 10, 14]];
    case "power":
      return [[0, 7, 12]];
  }
}

function triadTones(c: Chord): number[] {
  return c.tones.slice(0, 3);
}

function candidates(c: Chord, fam: VoicingFamily): number[][] {
  switch (fam) {
    case "rootless":
      return rootlessForms(c);
    case "triad": {
      const t = triadTones(c);
      // three inversions
      return [
        [t[0], t[1], t[2]],
        [t[1], t[2], t[0] + 12],
        [t[2], t[0] + 12, t[1] + 12],
      ];
    }
    case "open": {
      const forms = rootlessForms(c);
      // drop-2 of each rootless form
      return forms.map((f) => {
        const s = [...f].sort((a, b) => a - b);
        if (s.length < 4) return s;
        const dropped = s[2] - 12;
        return [dropped, s[0], s[1], s[3]].sort((a, b) => a - b);
      });
    }
    case "quartal": {
      const third = c.tones[1] ?? 4;
      const base = [third, third + 5, third + 10, third + 15];
      const fromRoot = [0, 7, 14, 16];
      return [base, fromRoot, [7, 12, 14, 19]];
    }
    case "shell": {
      const third = c.tones[1] ?? 4;
      const seventh = c.tones[3] ?? (c.quality === "maj" ? 9 : 7);
      return [
        [third, seventh, 14],
        [seventh - 12, third, 14 - 12 + 12],
        [third, seventh],
      ];
    }
  }
}

/**
 * Pick a voicing for a chord inside [lo, hi] that moves least from `prev`.
 * Returns ascending MIDI pitches.
 */
export function voiceChord(
  c: Chord,
  fam: VoicingFamily,
  lo: number,
  hi: number,
  prev: number[] | null,
): number[] {
  const center = prev?.length ? prev.reduce((s, p) => s + p, 0) / prev.length : (lo + hi) / 2;
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const form of candidates(c, fam)) {
    for (let oct = 1; oct <= 7; oct++) {
      const base = oct * 12 + c.root;
      const v = form.map((i) => base + i).sort((a, b) => a - b);
      if (v[0] < lo || v[v.length - 1] > hi) continue;
      let score = 0;
      if (prev?.length) {
        const n = Math.min(v.length, prev.length);
        for (let i = 0; i < n; i++) score += Math.abs(v[i] - prev[i]);
        score += Math.abs(v.length - prev.length) * 2;
      }
      const mid = v.reduce((s, p) => s + p, 0) / v.length;
      score += Math.abs(mid - center) * 0.5 + Math.abs(mid - (lo + hi) / 2) * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
  }
  if (best) return best;
  // fallback: close triad near the middle
  const mid = Math.round((lo + hi) / 2);
  const root = mid - mod(mid - c.root, 12);
  return triadTones(c).map((i) => root + i);
}

/** Root (or slash bass) of the chord in a bass register near `near`. */
export function bassNote(c: Chord, lo: number, hi: number, near: number | null): number {
  const pc = c.bass;
  let best = lo;
  let bestD = Infinity;
  for (let p = lo; p <= hi; p++) {
    if (mod(p, 12) !== pc) continue;
    const d = near === null ? Math.abs(p - (lo + 7)) : Math.abs(p - near);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
