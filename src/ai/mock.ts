// A fake gateway that answers each kind of prompt the way a decent model might —
// including some slop (fences, a bar outside the frame, a wrong role) to exercise repairs.
export function fakeModel(body: { system: string; prompt: string }): string {
  const { system, prompt } = body;
  if (prompt.includes("TASK — write the chart")) {
    return (
      "Here you go:\n```json\n" +
      JSON.stringify({
        concept: "A bouncy cell that climbs every chorus",
        motif: "r/8 F4/8 G4/8 A4/8 C5/4 Bb4/4",
        motifIdea: "climbing pickup",
        bars: [
          { bars: "1-4", texture: "groove", dynamic: "mf", cue: "state it plainly", parts: { fox: "@motif", frog: "@walk", owl: "@groove", bear: "@comp" } },
          { bars: "5-8", texture: "sparse", dynamic: "mf", parts: { fox: "@rest", frog: "@walk", owl: "@groove light", bear: "@motif invert" } },
          { bar: 9, texture: "build", dynamic: "f", parts: { fox: "@walk", frog: "@walk", owl: "@groove", bear: "@comp sparse" } },
          { bars: "10-15", texture: "peak", dynamic: "f", parts: { Rusty: "@motif up 2", frog: "@walk", owl: "@groove peak", bear: "@comp busy" } },
          { bar: 16, parts: { fox: "@end", frog: "@end", owl: "@end", bear: "@end" } },
          { bar: 17, parts: { fox: "C5/1" } },
        ],
      }) +
      "\n```"
    );
  }
  if (prompt.includes('"scores"')) {
    return JSON.stringify({
      scores: [
        { candidate: 1, distinctiveness: 6, coherence: 7, note: "fine" },
        { candidate: 2, distinctiveness: 9, coherence: 8, note: "unmistakably swing" },
      ],
      best: 2,
      summary: "Two has the real ride-and-walk texture.",
    });
  }
  if (prompt.includes("YOUR FEATURED BARS")) {
    const bars = [...prompt.matchAll(/bar (\d+):/g)].map((m) => m[1]);
    return JSON.stringify({ bars: Object.fromEntries(bars.map((b) => [b, "r/8 Bb4/8 C5/8 D5/8 F5/4 Eb5/8 D5/8"])) });
  }
  if (prompt.includes("Before you count off")) {
    return JSON.stringify({
      say: "Medium swing, Lily walk it, Hoot brushes till my solo.",
      motif: "r/8 F4/8 G4/8 A4/8 C5/4 Bb4/4",
      motifIdea: "climbing pickup",
      arc: [
        { bars: "1-4", texture: "groove", dynamic: "mf" },
        { bars: "5-12", texture: "build", dynamic: "f" },
        { bars: "13-16", texture: "peak", dynamic: "ff" },
      ],
      asks: { frog: "walk it, two-feel first", owl: "light ride", bear: "leave space" },
    });
  }
  if (prompt.includes('"default"')) {
    return JSON.stringify({ say: "Got it, boss.", default: system.includes("Bass") ? "@walk" : system.includes("Drums") ? "@groove light" : "@comp sparse" });
  }
  if (system.includes("spotlight")) {
    const bars = [...prompt.matchAll(/ {2}bar (\d+):/g)].map((m) => m[1]);
    return JSON.stringify({
      bars: Object.fromEntries(bars.map((b, i) => [b, i % 2 ? "@line dense" : "r/8 F4/8 G4/8 A4/8 C5/4 Bb4/4"])),
      say: "Bruno, answer me!",
    });
  }
  if (system.includes("accompanying")) {
    const bars = [...prompt.matchAll(/ {2}bar (\d+):/g)].map((m) => m[1]);
    const isDrums = system.includes("Drums");
    return JSON.stringify({
      bars: Object.fromEntries(bars.map((b) => [b, isDrums ? "rd:x...x.x.x...x.x. ph:....x.......x... sd:......g.....X..." : "@comp sparse"])),
      say: "",
    });
  }
  return "{}";
}
