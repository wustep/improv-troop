"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Score } from "../music/types";
import { BARS_PER_ROW, LABEL_W, MIN_ROW_WIDTH, MIN_ZOOM, NARROW_ROW, STAFF_H, buildModel, rowOf, rowRange, withRows, type SheetModel } from "./model";
import { TPB } from "./expand";
import { breakSystems, measureChart, renderRow, systemWidth, type BarGeom, type VF } from "./render";

export interface SheetStats {
  rows: number;
  renderMs: number;
  expandMs: number;
}

export interface SheetMusicProps {
  score: Score;
  /** Absolute beat from the chart start (negative during count-in). */
  getBeat: () => number;
  playing: boolean;
  /** Changes every time the user presses Play; re-enables follow-scroll. */
  playToken: number;
  onSeekBar?: (bar: number) => void;
  onStats?: (s: SheetStats) => void;
  className?: string;
}

// ─── VexFlow loading (client only, once) ─────────────────────────────────────

let vfPromise: Promise<VF> | null = null;

function loadVexFlow() {
  if (!vfPromise) {
    vfPromise = (async () => {
      const vf = await import("vexflow");
      let fonts: [string, string] = ["Petaluma", "Petaluma Script"];
      try {
        // The full vexflow entry registers its bundled fonts; wait for the handwritten pair.
        await Promise.race([
          Promise.all([document.fonts.load("30px Petaluma"), document.fonts.load('16px "Petaluma Script"')]),
          new Promise((r) => setTimeout(r, 4000)),
        ]);
        if (!document.fonts.check("30px Petaluma")) fonts = ["Bravura", "Academico"];
      } catch {
        fonts = ["Bravura", "Academico"];
      }
      vf.VexFlow.setFonts(...fonts);
      return vf;
    })();
  }
  return vfPromise;
}

// ─── Rendered-row cache (survives remounts; keyed by score content + width) ──

interface CachedRow {
  el: Element;
  bars: BarGeom[];
  renderMs: number;
}
const rowCache = new Map<string, Map<number, CachedRow>>();
const MAX_CACHED_SCORES = 8;

function cacheFor(key: string) {
  let m = rowCache.get(key);
  if (!m) {
    m = new Map();
    rowCache.set(key, m);
    while (rowCache.size > MAX_CACHED_SCORES) {
      const oldest = rowCache.keys().next().value;
      if (oldest === undefined) break;
      rowCache.delete(oldest);
    }
  } else {
    // LRU bump.
    rowCache.delete(key);
    rowCache.set(key, m);
  }
  return m;
}

/** Cheap content signature so appended phrases (same id) still re-render. */
function signature(score: Score) {
  const parts = score.members
    .map((m) => {
      const p = score.parts?.[m.id] ?? [];
      const last = p.length ? p[p.length - 1] : null;
      return `${m.id}:${m.instrument}:${p.length}:${last ? `${last.pitch}@${last.start}` : ""}`;
    })
    .join("|");
  const chords = (score.plan ?? []).map((b) => b.chords.map((c) => c.symbol).join(",")).join(";");
  return `${score.id}#${score.frame?.bars}#${score.frame?.meter?.beats}#${score.settings?.key?.tonic}${score.settings?.key?.mode}#${parts}#${chords.length}:${hash(chords)}`;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const ric: (cb: () => void) => number =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? (cb) => window.requestIdleCallback(cb, { timeout: 120 })
    : (cb) => window.setTimeout(cb, 16);
const cic: (id: number) => void =
  typeof window !== "undefined" && "cancelIdleCallback" in window ? (id) => window.cancelIdleCallback(id) : (id) => window.clearTimeout(id);

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"]);

// ─── Component ───────────────────────────────────────────────────────────────

export function SheetMusic({ score, getBeat, playing, playToken, onSeekBar, onStats, className }: SheetMusicProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);
  const geoms = useRef(new Map<number, BarGeom>());

  const [lib, setLib] = useState<VF | null>(null);
  // Measured width of the visible area. Systems are laid out at `width` (never narrower than
  // reads well) and the whole chart is scaled by `zoom` to fit, so it never scrolls sideways.
  const [avail, setAvail] = useState(0);

  const base: SheetModel = useMemo(() => buildModel(score), [score]);
  // How much room each bar needs, measured with the notes VexFlow will draw.
  const measure = useMemo(() => (lib && base.staffs.length ? measureChart(lib, base) : null), [lib, base]);
  // Systems take as many bars as fit (up to four; two on a phone), scaling the chart down a
  // little to fit more. Busy bars get a system to themselves instead of being clipped.
  const { rowStart, width, zoom } = useMemo(() => {
    if (!avail) return { rowStart: base.rowStart, width: 0, zoom: 1 };
    if (!measure) return { rowStart: base.rowStart, width: Math.max(avail, MIN_ROW_WIDTH), zoom: Math.min(1, avail / MIN_ROW_WIDTH) };
    const narrow = avail < NARROW_ROW;
    const pack = avail / (narrow ? MIN_ZOOM.narrow : MIN_ZOOM.wide);
    const starts = breakSystems(measure, pack, narrow ? 2 : BARS_PER_ROW);
    const need = Math.max(...starts.map((b, r) => systemWidth(measure, b, starts[r + 1] ?? measure.minW.length)));
    const w = Math.max(avail, Math.ceil(need));
    return { rowStart: starts, width: w, zoom: avail / w };
  }, [avail, measure, base]);
  const model: SheetModel = useMemo(() => withRows(base, rowStart), [base, rowStart]);
  const sig = useMemo(() => signature(score), [score]);

  // Latest callbacks without re-running effects.
  const cb = useRef({ getBeat, onSeekBar, onStats });
  useEffect(() => {
    cb.current = { getBeat, onSeekBar, onStats };
  });

  // Follow-scroll state.
  const follow = useRef({ on: true, lastRow: -1, progUntil: 0 });

  useEffect(() => {
    let alive = true;
    loadVexFlow()
      .then((l) => alive && setLib(l))
      .catch((e) => console.error("[sheet] failed to load VexFlow", e));
    return () => {
      alive = false;
    };
  }, []);

  // Width tracking (debounced).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: number | undefined;
    const measure = () => {
      const w = Math.max(240, Math.floor(el.clientWidth - 16));
      setAvail((prev) => (Math.abs(prev - w) < 4 ? prev : w));
    };
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(measure, 120);
    });
    ro.observe(el);
    measure();
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  // New chart: back to the top, follow again.
  const scoreId = score.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    follow.current.progUntil = performance.now() + 250;
    el.scrollTo({ top: 0 });
    follow.current.on = true;
    follow.current.lastRow = -1;
  }, [scoreId]);

  // Every Play re-enables follow.
  useEffect(() => {
    follow.current.on = true;
    follow.current.lastRow = -1;
  }, [playToken]);

  // Lazy, progressive row rendering.
  useEffect(() => {
    if (!lib || !width || !model.staffs.length) return;
    const root = scrollRef.current;
    if (!root) return;
    const cache = cacheFor(`${sig}@${width}/${model.rowStart.join(",")}`);
    geoms.current = new Map();
    const done = new Set<number>();
    const queue: number[] = [];
    let idle: number | null = null;
    let total = 0;

    const report = () => {
      cb.current.onStats?.({ rows: done.size, renderMs: total, expandMs: model.expandMs });
    };

    const renderOne = (row: number) => {
      if (done.has(row)) return;
      const host = rowEls.current[row];
      if (!host) return;
      done.add(row);
      const cached = cache.get(row);
      if (cached) {
        host.replaceChildren(cached.el);
        cached.bars.forEach((g) => geoms.current.set(g.bar, g));
        total += cached.renderMs;
        return;
      }
      try {
        const g = renderRow(lib, host, model, row, width, measure);
        total += g.renderMs;
        g.bars.forEach((b) => geoms.current.set(b.bar, b));
        const el = host.firstElementChild;
        if (el) cache.set(row, { el, bars: g.bars, renderMs: g.renderMs });
      } catch (e) {
        console.error("[sheet] row render failed", row, e);
        host.textContent = "";
      }
    };

    const pump = () => {
      idle = null;
      const start = performance.now();
      // A couple of rows per idle slice keeps frames smooth.
      while (queue.length && performance.now() - start < 24) {
        renderOne(queue.shift()!);
      }
      report();
      if (queue.length) idle = ric(pump);
    };
    const enqueue = (rows: number[], front = false) => {
      const fresh = rows.filter((r) => !done.has(r) && !queue.includes(r));
      if (!fresh.length) return;
      if (front) queue.unshift(...fresh);
      else queue.push(...fresh);
      if (idle === null) idle = ric(pump);
    };

    // Cached rows attach synchronously (no flash).
    for (let r = 0; r < model.rows; r++) if (cache.has(r)) renderOne(r);
    report();

    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.row));
        if (vis.length) enqueue(vis.sort((a, b) => a - b), true);
      },
      { root, rootMargin: "500px 0px" },
    );
    rowEls.current.slice(0, model.rows).forEach((el) => el && io.observe(el));

    // Then fill in the rest in the background, nearest first.
    const bg = window.setTimeout(() => {
      const all = Array.from({ length: model.rows }, (_, i) => i);
      enqueue(all);
    }, 300);

    return () => {
      io.disconnect();
      window.clearTimeout(bg);
      if (idle !== null) cic(idle);
    };
  }, [lib, width, sig, model, measure]);

  // Manual scroll cancels follow (until next Play).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const cancel = () => {
      follow.current.on = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) cancel();
    };
    const onPointer = (e: PointerEvent) => {
      // Pointer down on the scrollbar gutter.
      if (e.target === el && (e.offsetX >= el.clientWidth || e.offsetY >= el.clientHeight)) cancel();
    };
    const onScroll = () => {
      if (performance.now() > follow.current.progUntil) cancel();
    };
    const onScrollEnd = () => {
      follow.current.progUntil = Math.min(follow.current.progUntil, performance.now() + 30);
    };
    el.addEventListener("wheel", cancel, { passive: true });
    el.addEventListener("touchstart", cancel, { passive: true });
    el.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", onPointer);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    return () => {
      el.removeEventListener("wheel", cancel);
      el.removeEventListener("touchstart", cancel);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", onPointer);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
    };
  }, []);

  // Playhead loop (only while playing). Never touches VexFlow.
  useEffect(() => {
    const hl = highlightRef.current;
    const line = lineRef.current;
    if (!hl || !line) return;
    const hide = () => {
      hl.style.opacity = "0";
      line.style.opacity = "0";
    };
    if (!playing) {
      hide();
      return;
    }
    let raf = 0;
    const totalBeats = model.bars * model.bpb;
    const bandTop = (model.staffY[0] ?? 80) - 44;
    const bandBottom = (model.staffY[model.staffY.length - 1] ?? 80) + STAFF_H + 16;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      let beat = NaN;
      try {
        beat = cb.current.getBeat();
      } catch {
        /* transport not ready */
      }
      if (!Number.isFinite(beat) || beat < 0 || beat >= totalBeats) {
        hide();
        return;
      }
      const bar = Math.floor(beat / model.bpb);
      const row = rowOf(model, bar);
      const rowEl = rowEls.current[row];
      if (!rowEl) return;
      const g = geoms.current.get(bar);
      const [first, end] = rowRange(model, row);
      const est = (width - LABEL_W - 10) / Math.max(1, end - first);
      const gx = g ? g.x : LABEL_W + (bar - first) * est;
      const gw = g ? g.w : est;
      const inBar = (beat - bar * model.bpb) * TPB;
      const lx = g ? interpolateX(g.anchors, inBar) : gx + (gw * inBar) / (model.bpb * TPB);
      const top = rowEl.offsetTop + bandTop;
      const h = bandBottom - bandTop;
      hl.style.opacity = "1";
      hl.style.transform = `translate(${rowEl.offsetLeft + gx}px, ${top}px)`;
      hl.style.width = `${gw}px`;
      hl.style.height = `${h}px`;
      line.style.opacity = "1";
      line.style.transform = `translate(${rowEl.offsetLeft + lx}px, ${top}px)`;
      line.style.height = `${h}px`;

      const f = follow.current;
      const sc = scrollRef.current;
      if (f.on && sc && row !== f.lastRow) {
        f.lastRow = row;
        const rowTop = rowEl.offsetTop * zoom;
        const lead = Math.max(8, Math.min(sc.clientHeight / 3, sc.clientHeight - model.rowHeight * zoom - 8));
        const target = Math.max(0, rowTop - lead);
        if (Math.abs(sc.scrollTop - target) > 2) {
          f.progUntil = performance.now() + 1200;
          sc.scrollTo({ top: target, behavior: "smooth" });
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      hide();
    };
  }, [playing, model, width, zoom]);

  const onClick = (e: React.MouseEvent) => {
    const fn = cb.current.onSeekBar;
    if (!fn) return;
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!rowEl) return;
    const row = Number(rowEl.dataset.row);
    const x = (e.clientX - rowEl.getBoundingClientRect().left) / zoom;
    const [first, end] = rowRange(model, row);
    const last = end - 1;
    let bar = first;
    for (let b = first; b <= last; b++) {
      const g = geoms.current.get(b);
      const gx = g ? g.x : LABEL_W + (b - first) * ((width - LABEL_W) / Math.max(1, end - first));
      if (x >= gx) bar = b;
    }
    fn(bar);
  };

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      className={className}
      style={{ position: "relative", overflow: "auto", outline: "none", overscrollBehavior: "contain" }}
      aria-label={`Sheet music: ${score.title}`}
    >
      <div style={zoom < 1 ? { width: width * zoom, height: Math.max(40, model.rows * model.rowHeight) * zoom, overflow: "hidden" } : undefined}>
        <div
          ref={contentRef}
          onClick={onClick}
          style={{
            position: "relative",
            width: width || "100%",
            minHeight: 40,
            cursor: onSeekBar ? "pointer" : undefined,
            ...(zoom < 1 ? { transform: `scale(${zoom})`, transformOrigin: "0 0" } : {}),
          }}
        >
          {model.staffs.length === 0 ? (
            <div style={{ padding: "var(--space-l)", fontFamily: "var(--font-ui)", color: "var(--cte-text-muted)" }}>No players on the chart yet.</div>
          ) : (
            Array.from({ length: model.rows }, (_, r) => (
              <div
                key={`${sig}-${r}`}
                data-row={r}
                ref={(el) => {
                  rowEls.current[r] = el;
                }}
                className="sheet-row"
                style={{ height: model.rowHeight, width: width || "100%", position: "relative" }}
              />
            ))
          )}
          <div
            ref={highlightRef}
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              opacity: 0,
              pointerEvents: "none",
              borderRadius: "var(--radius-m)",
              background: "var(--color-2-transparent)",
              boxShadow: "inset 0 0 0 var(--border-m) var(--color-2-transparent)",
              mixBlendMode: "multiply",
              transition: "width 120ms ease, transform 120ms ease, opacity 200ms",
              willChange: "transform",
            }}
          />
          <div
            ref={lineRef}
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 2,
              opacity: 0,
              pointerEvents: "none",
              borderRadius: "var(--radius-full)",
              background: "var(--color-1)",
              willChange: "transform",
            }}
          />
        </div>
      </div>
      <style>{`.sheet-row:empty::before{content:"✎ inking the chart…";position:absolute;left:${LABEL_W}px;top:40px;font-family:var(--font-ui);color:var(--cte-text-muted);font-size:var(--size-m);line-height:var(--line-m)}`}</style>
    </div>
  );
}

function interpolateX(anchors: [number, number][], tick: number): number {
  if (!anchors.length) return 0;
  if (tick <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [t1, x1] = anchors[i];
    if (tick <= t1) {
      const [t0, x0] = anchors[i - 1];
      return t1 === t0 ? x1 : x0 + ((x1 - x0) * (tick - t0)) / (t1 - t0);
    }
  }
  return anchors[anchors.length - 1][1];
}
