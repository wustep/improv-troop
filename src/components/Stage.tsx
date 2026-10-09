"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimalSprite, IDLE_STATE, isPhrasing, type SpriteHandle } from "@/art/AnimalSprite";
import { troopAudio } from "@/audio/engine";
import { ANIMALS, INSTRUMENTS } from "@/music/instruments";
import { useDebug } from "@/state/debug";
import { canThink, useTroop } from "@/state/store";
import { openBrains } from "./ControlPanel";
import { FormMap } from "./FormMap";
import { Bunting } from "./stage/Bunting";
import { FrameComputer } from "./stage/frames";
import { RoughBox } from "./ui/rough";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Narrow screens shrink each slot so a horn reaching past it stays inside the stage (globals.css). */
const NARROW_SLOT = 0.84;

/**
 * Which way a player's speech bubble opens, and how wide it may grow. Alone in their row a
 * player gets room to say it on a line or two (staying on stage); when a neighbour is talking
 * too, bubbles keep to their own slot so they don't cover each other. Rows wrap on phones, so
 * this goes by the player's place in their own (centred) row.
 */
function bubbleFit(i: number, n: number, perRow: number, spriteW: number, width: number, crowded: boolean) {
  const GAP = 8; // gap-x-xs, and the bubble's inset from the slot edge
  const row = Math.floor(i / perRow);
  const cols = Math.min(perRow, n - row * perRow);
  const rowW = cols * spriteW + (cols - 1) * GAP;
  const left = (width - rowW) / 2 + (i % perRow) * (spriteW + GAP);
  // a left-anchored bubble grows rightward from the slot's left edge, and vice versa
  const roomRight = width - left - 2 * GAP;
  const roomLeft = left + spriteW - 2 * GAP;
  const right = roomLeft > roomRight;
  if (crowded) return { right, maxWidth: spriteW - GAP };
  return { right, maxWidth: Math.max(spriteW - GAP, Math.min(240, right ? roomLeft : roomRight)) };
}

function IntroNote({ onClose }: { onClose: () => void }) {
  const thinks = useTroop(canThink);
  return (
    <div className="sticky-note relative z-30 mx-auto mt-m w-full max-w-[19rem] -rotate-[1deg] px-s py-xs text-m lg:max-w-[46rem] lg:-rotate-[0.6deg]" role="note">
      <button type="button" onClick={onClose} className="absolute right-xs top-xxs text-l text-ink-soft transition-colors duration-(--motion-duration) hover:text-ink" aria-label="Dismiss">
        ×
      </button>
      <div className="type-label">How to jam</div>
      <ol className="ml-m list-decimal lg:ml-0 lg:flex lg:list-inside lg:gap-l">
        <li>
          Pick the band and their instruments <span className="hidden lg:inline">→</span>
          <span className="lg:hidden">(just below)</span>
        </li>
        <li>Press ▶ to hear their sketch</li>
        {thinks ? (
          <li>
            <b>Let them jam!</b> to make them think it through
          </li>
        ) : (
          <li>
            <button type="button" className="text-action" onClick={openBrains}>
              Add a gateway key
            </button>
            , then <b>Let them jam!</b> to make them think it through
          </li>
        )}
      </ol>
      <div className="mt-xxs text-xs text-ink-soft">Tap a name to mute them. Tap the form strip to jump around.</div>
    </div>
  );
}

function SharedNote() {
  const arrival = useTroop((s) => s.sharedArrival);
  const take = useTroop((s) => s.takes.find((t) => t.id === s.sharedArrival?.takeId));
  const play = useTroop((s) => s.play);
  const adopt = useTroop((s) => s.adoptSharedBand);
  const dismiss = useTroop((s) => s.dismissArrival);
  if (!arrival || !take) return null;
  const names = take.score.members.map((m) => m.name);
  const band = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return (
    <div className="sticky-note relative z-30 mx-auto mt-m w-full max-w-[19rem] -rotate-[1deg] px-s py-xs text-m lg:max-w-[46rem] lg:-rotate-[0.6deg]" role="note">
      <button type="button" onClick={dismiss} className="absolute right-xs top-xxs text-l text-ink-soft transition-colors duration-(--motion-duration) hover:text-ink" aria-label="Dismiss">
        ×
      </button>
      <div className="type-label">Someone sent you a take</div>
      <p>
        <b>{take.score.title}</b>, played by {band}.
      </p>
      <div className="mt-xxs flex flex-wrap gap-x-s">
        <button type="button" className="text-action" onClick={() => void play()}>
          ▶ play it
        </button>
        <button type="button" className="text-action" onClick={adopt}>
          jam with this band
        </button>
      </div>
    </div>
  );
}

export function Stage() {
  const score = useTroop((s) => s.current);
  const members = useTroop((s) => s.members);
  const playing = useTroop((s) => s.playing);
  const chat = useTroop((s) => s.chat);
  const genRunning = useTroop((s) => s.gen.running);
  const genMode = useTroop((s) => s.gen.mode);
  const calls = useDebug((s) => s.calls);
  const runId = useTroop((s) => s.gen.runId);
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const sprites = useRef(new Map<string, SpriteHandle | null>());
  const spots = useRef(new Map<string, HTMLDivElement | null>());
  const labelRef = useRef<HTMLSpanElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const chordRef = useRef<HTMLDivElement>(null);
  const nextChordRef = useRef<HTMLSpanElement>(null);
  const [bar, setBar] = useState(-1);
  const muted = useTroop((s) => s.muted);
  const toggleMute = useTroop((s) => s.toggleMute);
  const readyBars = useTroop((s) => s.readyBars);
  const autopilotBars = useTroop((s) => s.autopilotBars);
  const play = useTroop((s) => s.play);
  const seenIntro = useTroop((s) => s.seenIntro);
  const sharedArrival = useTroop((s) => !!s.sharedArrival);
  const dismissIntro = useTroop((s) => s.dismissIntro);

  // the band on stage is the chart's band when one is loaded (so sketches and takes match what you hear)
  const band = score?.members.length ? score.members : members;
  const n = Math.max(1, band.length);
  // narrow screens: up to three per row, sprites shrink rather than overflow. The slots size
  // themselves in CSS (a container query on the row), so the server-rendered first paint is
  // already laid out right on a phone; spriteW mirrors it for the spotlight and bubbles.
  const perRowNarrow = n === 4 ? 2 : Math.min(n, 3);
  const narrow = width < 560;
  const perRow = narrow ? perRowNarrow : n;
  const spriteW = Math.max(84, Math.min(220, ((width - 8) / perRow - 8) * (narrow ? NARROW_SLOT : 1)));

  const computer = useMemo(() => (score ? new FrameComputer(score) : null), [score]);

  // per-frame animation: read the audio clock, hand each sprite its state
  useEffect(() => {
    const mutedSet = new Set(muted);
    let raf = 0;
    // -3: not drawn yet, so a stop (which restarts this effect) clears the header on its first frame
    let lastBar = -3;
    const loop = () => {
      const isPlaying = troopAudio.isPlaying() && playing;
      const beat = isPlaying ? troopAudio.getBeat() : -Infinity;
      const spb = troopAudio.getSecondsPerBeat() || 0.5;
      for (const m of band) {
        const h = sprites.current.get(m.id);
        if (!h) continue;
        let st = computer && Number.isFinite(beat) ? computer.compute(m.id, beat, true, spb) : { ...IDLE_STATE, bpm: score?.frame.tempo ?? 100 };
        // a muted player makes no sound, so they sit out and listen instead of miming
        if (mutedSet.has(m.id)) st = { ...st, role: "rest", featured: false, active: [], recent: [], upcoming: [], nextOnsetIn: Infinity, nextPitch: null };
        h.update(st);
        const spot = spots.current.get(m.id);
        // the spotlight stays on the soloist, softer while they breathe between phrases
        if (spot) spot.style.opacity = st.featured && Number.isFinite(beat) && beat >= 0 ? (isPhrasing(st) ? "1" : "0.45") : "0";
      }
      if (score && Number.isFinite(beat)) {
        const beats = score.frame.meter.beats;
        const b = beat < 0 ? -1 : Math.min(score.frame.bars - 1, Math.floor(beat / beats));
        if (b !== lastBar) {
          lastBar = b;
          setBar(b);
          if (labelRef.current) labelRef.current.textContent = b < 0 ? "count-in…" : (score.plan[b]?.section ?? "");
          // the counter has its own fixed width, so the line doesn't shift as the bar number grows
          if (counterRef.current) counterRef.current.textContent = b < 0 ? "" : `· bar ${b + 1}/${score.frame.bars}`;
        }
        if (chordRef.current && b >= 0) {
          const inBar = beat - b * beats;
          const chords = score.frame.chords[b] ?? [];
          let sym = chords[0]?.symbol ?? "";
          for (const c of chords) if (c.beat <= inBar + 1e-6) sym = c.symbol;
          if (chordRef.current.textContent !== sym) {
            chordRef.current.textContent = sym;
            // a change inks in, so it reads apart from a repeat (restarting the animation, not a React render)
            chordRef.current.classList.remove("chord-ink");
            void chordRef.current.offsetWidth;
            chordRef.current.classList.add("chord-ink");
          }
          // read ahead, like the band does: the next change in this bar or the next two
          let next = "";
          for (let k = b; k < Math.min(score.frame.bars, b + 3) && !next; k++) {
            for (const c of score.frame.chords[k] ?? []) {
              if ((k > b || c.beat > inBar + 1e-6) && c.symbol !== sym) {
                next = `→ ${c.symbol}`;
                break;
              }
            }
          }
          if (nextChordRef.current && nextChordRef.current.textContent !== next) nextChordRef.current.textContent = next;
        }
      } else if (lastBar !== -2) {
        lastBar = -2;
        setBar(-1);
        // stopped: the stage says what's loaded, so you know what Play will play
        if (labelRef.current) labelRef.current.textContent = score?.title ?? "";
        if (counterRef.current) counterRef.current.textContent = "";
        if (chordRef.current) chordRef.current.textContent = "";
        if (nextChordRef.current) nextChordRef.current.textContent = score ? `${score.frame.key.tonic} ${score.frame.key.mode} · ${score.frame.tempo} bpm` : "";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [band, computer, playing, score, muted]);

  // speech bubbles: during the count-off show the latest line per player; while playing, lines appear at their bar
  const bubbles = useMemo(() => {
    const out: Record<string, string> = {};
    const msgs = chat.length ? chat : (score?.chat ?? []);
    if (playing && bar >= 0) {
      for (const c of msgs) if (c.bar !== undefined && c.bar <= bar && c.bar >= bar - 1 && c.phase === "jam") out[c.from] = c.text;
    } else if (genRunning) {
      for (const c of msgs) out[c.from] = c.text;
    }
    return out;
  }, [chat, score, playing, bar, genRunning]);

  const thinking = useMemo(() => {
    const s = new Set<string>();
    for (const c of calls) if (c.status === "pending" && c.runId === runId) s.add(c.agent);
    return s;
  }, [calls, runId]);

  const directorNote = useMemo(() => {
    const msgs = chat.length ? chat : (score?.chat ?? []);
    const d = msgs.filter((c) => c.from === "director" && (c.bar === undefined || c.bar <= Math.max(0, bar)));
    return d.length ? d[d.length - 1].text : null;
  }, [chat, score, bar]);

  return (
    <RoughBox seed="stage" rough={{ weight: "l" }} className="stage-paper w-full p-s">
      <div ref={wrapRef} className="relative">
        <Bunting />
        <div className="flex min-h-7 items-baseline justify-between gap-s px-xs pt-9 font-brand font-heavy text-ink-soft">
          <div className="flex min-w-0 items-baseline gap-xxs text-l" aria-live="off">
            <span ref={labelRef} className="truncate" />
            <span ref={counterRef} className="shrink-0 tabular-nums" style={{ minWidth: score ? `${`· bar ${score.frame.bars}/${score.frame.bars}`.length}ch` : undefined }} />
          </div>
          <div className="flex shrink-0 items-baseline gap-xs">
            <div ref={chordRef} className="text-xl text-(--color-3)" aria-label="current chord" />
            <span ref={nextChordRef} className="text-m text-ink-soft" aria-hidden />
          </div>
        </div>

        {(genMode === "composer" || score?.engine === "ai") && (directorNote || thinking.has("director") || thinking.has("critic")) && (
          <div className="director-card absolute right-xs top-16 z-20 max-w-[16rem] rotate-[1.5deg] px-s py-xs text-s">
            <div className="type-label">
              {thinking.has("critic") ? "the judge is listening…" : thinking.has("director") ? "director is writing…" : "director's note"}
            </div>
            {directorNote && !thinking.has("director") && <div>{directorNote}</div>}
          </div>
        )}

        <div
          className="band-row relative flex flex-wrap items-end justify-center gap-x-xs gap-y-l pt-10"
          style={{ "--per": n, "--per-narrow": perRowNarrow } as React.CSSProperties}
        >
          {band.map((m, i) => {
            const inst = INSTRUMENTS[m.instrument];
            const bubble = bubbles[m.id];
            const isThinking = thinking.has(m.id);
            const isMuted = muted.includes(m.id);
            const row = Math.floor(i / perRow);
            const crowded = band.some((o, j) => j !== i && Math.floor(j / perRow) === row && (bubbles[o.id] || thinking.has(o.id)));
            const fit = bubbleFit(i, n, perRow, spriteW, width, crowded);
            return (
              <div key={`${m.id}:${m.instrument}`} className="band-slot relative flex flex-col items-center">
                <div
                  ref={(el) => {
                    spots.current.set(m.id, el);
                  }}
                  className="spotlight pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2"
                  style={{ width: spriteW * 1.15, height: spriteW * 1.3, opacity: 0 }}
                />
                {(bubble || isThinking) && (
                  <div
                    // a new line is a new bubble: it pops in rather than swapping its words in place
                    key={bubble && !isThinking ? `say:${bubble}` : "thinking"}
                    className={`bubble absolute z-10 ${fit.right ? "bubble-right right-xs" : "left-xs"} w-max px-s py-xs text-m`}
                    style={{ bottom: spriteW * 1.04, maxWidth: fit.maxWidth }}
                  >
                    {bubble && !isThinking ? bubble : <span className="thinking-dots" aria-label={`${m.name} is thinking`}><i>.</i><i>.</i><i>.</i></span>}
                  </div>
                )}
                <div className={`transition-opacity duration-(--motion-large-duration) ease-small ${isMuted ? "opacity-40 grayscale-[0.6]" : ""}`}>
                  <AnimalSprite
                    ref={(h) => {
                      sprites.current.set(m.id, h);
                    }}
                    animal={m.animal}
                    instrument={m.instrument}
                    size={spriteW}
                    className="block h-auto w-full"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => toggleMute(m.id)}
                  aria-pressed={isMuted}
                  title={isMuted ? `Bring ${m.name} back in` : `Mute ${m.name}`}
                  className="pick group -mt-xxs px-xs text-center"
                >
                  <div className={`type-label ${isMuted ? "line-through decoration-2" : ""}`} style={{ color: ANIMALS[m.animal].ink }}>
                    {m.name}
                    {score?.frame.leaderId === m.id && <span className="ml-xxs text-s text-(--color-1)" aria-label="leader">★</span>}
                  </div>
                  <div className="text-s text-ink-soft">
                    {isMuted ? "muted · tap to unmute" : inst.name}
                    {!isMuted && <span className="ml-xxs hidden text-xs group-hover:inline">· tap to mute</span>}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
        {score && (
          <FormMap
            score={score}
            playing={playing}
            readyBars={readyBars}
            autopilotBars={autopilotBars}
            onSeek={(b) => void play(b)}
          />
        )}
        {sharedArrival ? <SharedNote /> : !seenIntro && <IntroNote onClose={dismissIntro} />}
      </div>
    </RoughBox>
  );
}
