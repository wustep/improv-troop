"use client";

import { useCallback, useEffect, useState } from "react";
import { DoodleDefs } from "@/art/DoodleDefs";
import { troopAudio } from "@/audio/engine";
import { BandTalk } from "@/components/BandTalk";
import { ControlPanel } from "@/components/ControlPanel";
import { DebugPanel } from "@/components/DebugPanel";
import { Stage } from "@/components/Stage";
import { Takes, Transport } from "@/components/Transport";
import { RoughBox, Squiggle } from "@/components/ui/rough";
import { SheetMusic, type SheetStats } from "@/sheet/SheetMusic";
import { useDebug } from "@/state/debug";
import { useTroop } from "@/state/store";

export default function Home() {
  const hydrate = useTroop((s) => s.hydrate);
  const score = useTroop((s) => s.current);
  const playing = useTroop((s) => s.playing);
  const playToken = useTroop((s) => s.playToken);
  const play = useTroop((s) => s.play);
  const debugOpen = useDebug((s) => s.open);
  const setDebugOpen = useDebug((s) => s.setOpen);
  const [sheetStats, setSheetStats] = useState<SheetStats | null>(null);
  const [showSheet, setShowSheet] = useState(true);

  useEffect(() => {
    hydrate();
    // dev-only handle for automated play-throughs (transport + store)
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __jamming?: unknown }).__jamming = { audio: troopAudio, store: useTroop };
    }
    try {
      if (new URLSearchParams(location.search).has("debug")) setDebugOpen(true);
    } catch {
      /* ignore */
    }
  }, [hydrate, setDebugOpen]);

  const getBeat = useCallback(() => troopAudio.getBeat(), []);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-4 sm:px-6">
      <DoodleDefs />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-[family-name:var(--font-script)] text-5xl font-bold leading-none sm:text-6xl">Jamming</h1>
          <Squiggle width={250} seed="title" color="var(--pencil-red)" />
          <p className="text-[15px] text-ink-soft">Pick the band, hand them instruments, and let them make something up.</p>
        </div>
        <button
          type="button"
          onClick={() => setDebugOpen(!debugOpen)}
          className="text-[15px] text-ink-soft underline decoration-dotted underline-offset-4 hover:text-ink"
          aria-expanded={debugOpen}
        >
          {debugOpen ? "hide" : "peek"} under the hood
        </button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0">
          <Stage />
          <div className="mt-3">
            <Transport />
          </div>
          {debugOpen && <DebugPanel sheetStats={sheetStats} />}
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <BandTalk />
            <Takes />
          </div>
          <section className="mt-5" aria-label="Sheet music">
            <div className="mb-1 flex items-baseline gap-3">
              <h2 className="font-[family-name:var(--font-script)] text-3xl font-bold">The chart</h2>
              <button type="button" className="text-sm text-ink-soft underline decoration-dotted underline-offset-4" onClick={() => setShowSheet((v) => !v)}>
                {showSheet ? "fold it up" : "unfold"}
              </button>
              {score && <span className="text-sm text-ink-soft">click a bar to play from there</span>}
            </div>
            {showSheet && score && (
              <RoughBox seed="sheet" rough={{ strokeWidth: 1.4 }} className="sheet-paper p-2">
                <SheetMusic
                  score={score}
                  getBeat={getBeat}
                  playing={playing}
                  playToken={playToken}
                  onSeekBar={(bar) => void play(bar)}
                  onStats={setSheetStats}
                  className="h-[min(70vh,640px)]"
                />
              </RoughBox>
            )}
          </section>
        </main>
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <ControlPanel />
        </div>
      </div>
      <footer className="mt-8 text-center text-sm text-ink-soft">
        Samples: Salamander Grand Piano, Splendid Grand, Smolken double bass, LinnDrum (LM-2), VCSL, MusyngKite soundfonts — via smplr. Notation by VexFlow.
      </footer>
    </div>
  );
}
