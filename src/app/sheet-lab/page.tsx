"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { SheetMusic, type SheetStats } from "@/sheet/SheetMusic";
import { fixtureDrumsOnly, fixtureEmpty, fixtureSix, fixtureSwing, fixtureWaltz } from "@/sheet/fixture";
import type { Score } from "@/music/types";

const FIXTURES: Record<string, () => Score> = {
  swing: fixtureSwing,
  waltz: fixtureWaltz,
  six: fixtureSix,
  drums: fixtureDrumsOnly,
  empty: fixtureEmpty,
};

export default function SheetLab() {
  const [which, setWhich] = useState("swing");
  const score = useMemo(() => FIXTURES[which](), [which]);
  const [playing, setPlaying] = useState(false);
  const [playToken, setPlayToken] = useState(0);
  const [stats, setStats] = useState<SheetStats | null>(null);
  const [seek, setSeek] = useState<number | null>(null);
  const t0 = useRef(0);
  const offset = useRef(0);

  const bpb = score.frame.meter.beats;
  const tempo = score.frame.tempo;
  const getBeat = useCallback(() => {
    if (!t0.current) return -1;
    return ((performance.now() - t0.current) / 1000) * (tempo / 60) - bpb + offset.current;
  }, [tempo, bpb]);

  const play = (fromBar = 0) => {
    offset.current = fromBar * bpb;
    t0.current = performance.now();
    setPlaying(true);
    setPlayToken((t) => t + 1);
  };

  return (
    <main style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, height: "100vh", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 18 }}>
        <strong style={{ fontFamily: "var(--font-script)", fontSize: 28 }}>Sheet lab</strong>
        {Object.keys(FIXTURES).map((k) => (
          <button key={k} onClick={() => setWhich(k)} style={btn(which === k)} data-fixture={k}>
            {k}
          </button>
        ))}
        <span style={{ width: 16 }} />
        <button onClick={() => play()} style={btn(false)} data-testid="play">
          ▶ Play
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            t0.current = 0;
          }}
          style={btn(false)}
          data-testid="stop"
        >
          ■ Stop
        </button>
        <span style={{ color: "#6a6474" }} data-testid="stats">
          {stats ? `${stats.rows} rows · render ${stats.renderMs.toFixed(1)}ms · expand ${stats.expandMs.toFixed(2)}ms` : "…"}
          {seek !== null ? ` · seek bar ${seek + 1}` : ""}
        </span>
      </div>
      <SheetMusic
        score={score}
        getBeat={getBeat}
        playing={playing}
        playToken={playToken}
        onSeekBar={(b) => {
          setSeek(b);
          if (playing) play(b);
        }}
        onStats={setStats}
        className="sheet-lab-scroll"
      />
      <style>{`.sheet-lab-scroll{flex:1;min-height:0;border:1.5px solid #2c2a35;border-radius:14px;background:rgba(255,255,255,0.25)}`}</style>
    </main>
  );
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: "4px 12px",
    border: "1.5px solid #2c2a35",
    borderRadius: 10,
    background: active ? "#f2c446" : "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 16,
  };
}
