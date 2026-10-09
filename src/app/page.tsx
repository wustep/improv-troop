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
      (window as unknown as { __jamming?: unknown }).__jamming = { audio: troopAudio, store: useTroop, debug: useDebug };
    }
    try {
      if (new URLSearchParams(location.search).has("debug")) setDebugOpen(true);
    } catch {
      /* ignore */
    }
  }, [hydrate, setDebugOpen]);

  const getBeat = useCallback(() => troopAudio.getBeat(), []);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-m pb-xxl pt-m sm:px-l">
      <DoodleDefs />
      <header className="mb-s flex flex-wrap items-end justify-between gap-xs">
        <div>
          <h1 className="font-brand text-xxl font-heavy">Jamming</h1>
          <Squiggle width={250} seed="title" color="var(--pencil-red)" />
          <p className="text-m text-ink-soft">Pick the band, hand them instruments, and let them make something up.</p>
        </div>
        <button
          type="button"
          onClick={() => setDebugOpen(!debugOpen)}
          className="text-action text-m"
          aria-expanded={debugOpen}
        >
          {debugOpen ? "hide" : "peek"} under the hood
        </button>
      </header>

      {/* Below lg the page is one column, and main's pieces join the grid so the band settings sit
          right under the stage instead of below the whole chart. */}
      <div className="grid gap-l lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="contents min-w-0 lg:block">
          <div className="order-1 min-w-0 lg:order-none">
            <Stage />
            <div className="mt-s">
              <Transport />
            </div>
            {debugOpen && <DebugPanel sheetStats={sheetStats} />}
          </div>
          <div className="order-3 grid min-w-0 gap-m md:grid-cols-[minmax(0,1fr)_260px] lg:order-none lg:mt-l">
            <BandTalk />
            <Takes />
          </div>
          <section className="order-4 min-w-0 lg:order-none lg:mt-l" aria-label="Sheet music">
            <div className="mb-xs flex items-baseline gap-s">
              <h2 className="type-section">The chart</h2>
              {score ? (
                <>
                  <button type="button" className="text-action text-s" onClick={() => setShowSheet((v) => !v)}>
                    {showSheet ? "fold it up" : "unfold"}
                  </button>
                  <span className="text-s text-ink-soft">click a bar to play from there</span>
                </>
              ) : (
                <span className="text-s text-ink-soft">invite someone to the band to see their parts</span>
              )}
            </div>
            {showSheet && score && (
              <RoughBox seed="sheet" rough={{ weight: "m" }} className="sheet-paper p-xs">
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
        <div className="order-2 min-w-0 lg:sticky lg:top-m lg:order-none lg:max-h-[calc(100vh-2*var(--space-m))] lg:self-start lg:overflow-y-auto">
          <ControlPanel />
        </div>
      </div>
      <footer className="mt-xl text-center text-s text-ink-soft">
        Samples: Salamander Grand Piano (Alexander Holm), Splendid Grand, Greg Sullivan’s Wurlitzer and CP80, Smolken double bass, VCSL drums and vibraphone, LinnDrum (LM-2), MusyngKite and FluidR3 soundfonts — via smplr. Notation by VexFlow.
      </footer>
    </div>
  );
}
