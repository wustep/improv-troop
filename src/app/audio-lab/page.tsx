"use client";

import { useEffect, useRef, useState } from "react";
import { troopAudio, type DrumKit, type LoadState, type PianoPack, type PlaybackStats } from "@/audio/engine";
import { DEFAULT_SOUNDS, DRUM_KITS, PIANO_PACKS } from "@/audio/packs";
import { notesHintFromScore } from "@/audio/engine";
import { AUDIO_FIXTURE } from "@/audio/fixture";

export default function AudioLab() {
  const [pack, setPack] = useState<PianoPack>("salamander");
  const [kit, setKit] = useState<DrumKit>("acoustic");
  const [loads, setLoads] = useState<LoadState[]>([]);
  const [state, setState] = useState("stopped");
  const [stats, setStats] = useState<PlaybackStats | null>(null);
  const [loop, setLoop] = useState(false);
  const [ended, setEnded] = useState(0);
  const beatRef = useRef<HTMLSpanElement>(null);

  useEffect(() => troopAudio.onLoad(setLoads), []);
  useEffect(() => {
    // Handles for poking the engine from devtools / automated checks.
    Object.assign(window, { __troopAudio: troopAudio, __fixture: AUDIO_FIXTURE });
  }, []);
  useEffect(() => troopAudio.onEnded(() => setEnded((n) => n + 1)), []);

  useEffect(() => {
    let raf = 0;
    const loopFrame = () => {
      const beat = troopAudio.getBeat();
      if (beatRef.current) {
        beatRef.current.textContent = Number.isFinite(beat)
          ? `beat ${beat.toFixed(2)} · bar ${Math.floor(beat / 4) + 1} · level ${troopAudio.getOutputLevel().toFixed(3)}`
          : "—";
      }
      raf = requestAnimationFrame(loopFrame);
    };
    raf = requestAnimationFrame(loopFrame);
    const poll = setInterval(() => {
      setState(troopAudio.getState());
      setStats(troopAudio.getStats());
    }, 250);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(poll);
    };
  }, []);

  const prepare = () =>
    troopAudio.prepare(AUDIO_FIXTURE.members, {
      sounds: { ...DEFAULT_SOUNDS, piano: pack, drums: kit },
      notesHint: notesHintFromScore(AUDIO_FIXTURE),
    });

  return (
    <main style={{ padding: 24, fontFamily: "monospace", maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Audio lab</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          piano pack{" "}
          <select
            data-testid="pack"
            value={pack}
            onChange={(e) => setPack(e.target.value as PianoPack)}
          >
            {PIANO_PACKS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          drum kit{" "}
          <select data-testid="kit" value={kit} onChange={(e) => setKit(e.target.value as DrumKit)}>
            {DRUM_KITS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <button data-testid="prepare" onClick={() => void prepare()}>
          Prepare
        </button>
        <button
          data-testid="play"
          onClick={async () => {
            await troopAudio.unlock();
            void prepare();
            troopAudio.play(AUDIO_FIXTURE, { loop });
          }}
        >
          Unlock + Play
        </button>
        <button data-testid="stop" onClick={() => troopAudio.stop()}>
          Stop
        </button>
        <label>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> loop
        </label>
      </div>
      <p style={{ marginTop: 12 }}>
        state: <b data-testid="state">{state}</b> · <span ref={beatRef} data-testid="beat" /> · ended:{" "}
        {ended}
      </p>
      <h2 style={{ marginTop: 16 }}>Instruments</h2>
      <ul data-testid="loads">
        {loads.map((l) => (
          <li key={l.memberId}>
            {l.memberId} · {l.instrument} · {l.pack || "…"} · {l.loaded}/{l.total}{" "}
            {l.ready ? "ready" : l.error ? `FAILED: ${l.error}` : "loading"}
          </li>
        ))}
      </ul>
      <h2 style={{ marginTop: 16 }}>Scheduler</h2>
      <pre data-testid="stats">{stats ? JSON.stringify(stats, null, 2) : "—"}</pre>
    </main>
  );
}
