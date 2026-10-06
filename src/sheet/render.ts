// VexFlow rendering of one row (system of up to 4 bars). Client-only.

import type * as VexNS from "vexflow";
import type { StaveNote as StaveNoteT, Stave as StaveT, Tuplet as TupletT, Beam as BeamT, Voice as VoiceT } from "vexflow";
import { chordText, drumKeys, spell, TPB, type Token } from "./expand";
import { LABEL_W, rowRange, STAFF_H, type ClefName, type SheetModel, type StaffSpec } from "./model";

export type VF = typeof VexNS;

export const INK = "#2c2a35";
const INK_SOFT = "#6a6474";
const TEXT_FONT = '"Petaluma Script", var(--font-hand), "Comic Sans MS", cursive';

export interface BarGeom {
  bar: number;
  row: number;
  x: number;
  w: number;
  /** [tick in bar, x] sorted by tick, including bar start and end. */
  anchors: [number, number][];
}

export interface RowGeom {
  row: number;
  bars: BarGeom[];
  renderMs: number;
}

const REST_KEY: Record<ClefName, string> = { treble: "b/4", bass: "d/3", tenor: "a/3", percussion: "b/4" };

function makeNote(vf: VF, t: Token, staff: StaffSpec, model: SheetModel, clef: ClefName): StaveNoteT {
  const { StaveNote, Dot } = vf;
  if (t.kind === "rest") {
    const n = new StaveNote({
      keys: [REST_KEY[clef]],
      duration: t.fullBar ? "w" : t.dur,
      dots: t.fullBar ? 0 : t.dots,
      type: "r",
      clef,
      alignCenter: !!t.fullBar,
    });
    if (t.dots && !t.fullBar) Dot.buildAndAttach([n], { all: true });
    return n;
  }
  const keys = staff.drums ? drumKeys(t.pitches) : t.pitches.map((p) => spell(clampPitch(p), model.spelling).key);
  const n = new StaveNote({
    keys,
    duration: t.dur,
    dots: t.dots,
    clef,
    ...(staff.drums ? { stemDirection: 1 } : { autoStem: true }),
  });
  if (t.dots) Dot.buildAndAttach([n], { all: true });
  return n;
}

/** Articulations go on the notehead side, after beaming has settled stem directions. */
function addArticulations(vf: VF, notes: StaveNoteT[], tokens: Token[]) {
  const { Articulation, Modifier } = vf;
  tokens.forEach((t, k) => {
    if (t.kind !== "note" || !t.art || t.tiedFrom) return;
    const code = t.art === "accent" ? "a>" : t.art === "staccato" ? "a." : null;
    if (!code) return;
    const n = notes[k];
    const up = n.getStemDirection() === 1;
    n.addModifier(new Articulation(code).setPosition(up ? Modifier.Position.BELOW : Modifier.Position.ABOVE), 0);
  });
}

/** Keep absurd pitches from producing 15 ledger lines. */
function clampPitch(p: number) {
  let x = p;
  while (x > 100) x -= 12;
  while (x < 24) x += 12;
  return x;
}

interface Cell {
  stave: StaveT;
  notes: StaveNoteT[];
  tokens: Token[];
  voice: VoiceT;
  beams: BeamT[];
  tuplets: TupletT[];
}

/** One bar's worth of staves (one per staff) with notes, beams and tuplets, not yet placed. */
function buildColumn(vf: VF, model: SheetModel, row: number, bar: number, rowStart: boolean, left = LABEL_W): Cell[] {
  const { Stave, Voice, Beam, Tuplet, Accidental, Fraction, BarlineType } = vf;
  const { staffs, bpb } = model;
  const isFirstRow = row === 0;
  const col: Cell[] = [];
  staffs.forEach((staff, si) => {
    const clef = staff.rowClef?.[row] ?? staff.clef;
    const stave = new Stave(left, model.staffY[si] - 40, 200);
    stave.setDefaultLedgerLineStyle({ strokeStyle: INK, lineWidth: 1.3 });
    if (rowStart) {
      stave.addClef(clef);
      if (!staff.drums) stave.addKeySignature(model.keySpec);
      if (isFirstRow) stave.addTimeSignature(`${bpb}/4`);
    }
    if (bar === model.bars - 1) stave.setEndBarType(BarlineType.END);
    const tokens = staff.bars[bar]?.tokens ?? [];
    const notes = tokens.map((t) => makeNote(vf, t, staff, model, clef));

    // Tuplets per triplet beat (must exist before the voice counts ticks).
    const tuplets: TupletT[] = [];
    const byBeat = new Map<number, StaveNoteT[]>();
    tokens.forEach((t, k) => {
      if (!t.triplet) return;
      const arr = byBeat.get(t.beat) ?? [];
      arr.push(notes[k]);
      byBeat.set(t.beat, arr);
    });
    for (const group of byBeat.values()) {
      const toks = tokens.filter((t) => t.triplet && t.beat === tokens[notes.indexOf(group[0])].beat);
      const beamable = group.length >= 3 && toks.every((t) => t.kind === "note" && (t.dur === "8" || t.dur === "16"));
      tuplets.push(new Tuplet(group, { numNotes: 3, notesOccupied: 2, bracketed: !beamable, ratioed: false }));
    }

    const voice = new Voice({ numBeats: bpb, beatValue: 4 }).setMode(Voice.Mode.SOFT);
    voice.addTickables(notes);
    voice.setStave(stave);
    if (!staff.drums) {
      try {
        Accidental.applyAccidentals([voice], model.keySpec);
      } catch {
        /* exotic spelling; skip accidentals for this bar */
      }
    }
    let beams: BeamT[] = [];
    try {
      beams = Beam.generateBeams(notes, {
        groups: [new Fraction(1, 4)],
        ...(staff.drums ? { stemDirection: 1, maintainStemDirections: false } : {}),
      });
    } catch {
      beams = [];
    }
    addArticulations(vf, notes, tokens);
    col.push({ stave, notes, tokens, voice, beams, tuplets });
  });
  return col;
}

/** Room each bar needs, measured with the same notes the renderer draws. */
export interface ChartMeasure {
  /** Minimum note-area width per bar. */
  minW: number[];
  /** Clef + key (+ time on the first system) in front of a system's first bar. */
  begFirst: number;
  beg: number;
  /** Padding in front of the notes of a bar in the middle of a system. */
  plain: number;
}

export function measureChart(vf: VF, model: SheetModel): ChartMeasure {
  const { Formatter, Stave } = vf;
  const minW: number[] = [];
  for (let bar = 0; bar < model.bars; bar++) {
    const col = buildColumn(vf, model, 1, bar, false);
    try {
      // Format as tight as it goes and see how far the notes actually reach (the formatter's
      // own minimum-width estimate runs about twice what it really draws).
      const f = new Formatter();
      col.forEach((c) => f.joinVoices([c.voice]));
      f.format(
        col.map((c) => c.voice),
        0,
      );
      let reach = 40;
      for (const c of col) {
        const start = c.stave.getNoteStartX();
        for (const n of c.notes) reach = Math.max(reach, n.getAbsoluteX() + n.getWidth() - start);
      }
      minW.push(reach);
    } catch {
      minW.push(160);
    }
  }
  const begOf = (row: number) => {
    const col = buildColumn(vf, model, row, 0, true);
    if (!col.length) return 12;
    Stave.formatBegModifiers(col.map((c) => c.stave));
    return Math.max(...col.map((c) => c.stave.getNoteStartX() - c.stave.getX()));
  };
  const plainCol = buildColumn(vf, model, 1, Math.min(1, model.bars - 1), false);
  const plain = plainCol[0] ? plainCol[0].stave.getNoteStartX() - plainCol[0].stave.getX() : 12;
  return { minW, begFirst: begOf(0), beg: begOf(1), plain };
}

/** Air on top of a bar's tightest width: the formatter spreads notes by duration and pads the
 * bar's end, so a bar given exactly its minimum lets its last notes spill past the barline. */
const SLACK = 1.04;
const AIR = 16;

/** Bar padding the renderer adds on top of a bar's minimum width. */
export const BAR_PAD = 26;

/** Width (px) a system of bars [first, end) needs, with a little air. */
export function systemWidth(m: ChartMeasure, first: number, end: number): number {
  let w = LABEL_W + 24 + (first === 0 ? m.begFirst : m.beg) - m.plain;
  for (let b = first; b < end; b++) w += m.minW[b] * SLACK + AIR + m.plain + BAR_PAD;
  return w;
}

/**
 * Break the chart into systems the way an engraver would: each system takes as many bars
 * (up to `maxPerRow`) as fit in `width`. Returns the first bar of each system.
 */
export function breakSystems(m: ChartMeasure, width: number, maxPerRow: number): number[] {
  const starts: number[] = [];
  let first = 0;
  while (first < m.minW.length) {
    starts.push(first);
    let end = first + 1;
    while (end < m.minW.length && end - first < maxPerRow && systemWidth(m, first, end + 1) <= width) end++;
    first = end;
  }
  // don't leave the final bar alone on its own system when the one before can spare a bar
  const k = starts.length - 1;
  if (k >= 1 && m.minW.length - starts[k] === 1 && starts[k] - starts[k - 1] >= 3) starts[k]--;
  return starts;
}

export function renderRow(vf: VF, host: HTMLElement, model: SheetModel, row: number, width: number, measure?: ChartMeasure | null): RowGeom {
  const t0 = performance.now();
  const { Renderer, Stave, Formatter, StaveTie, StaveConnector } = vf;

  host.innerHTML = "";
  const renderer = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, model.rowHeight);
  const ctx = renderer.getContext();
  ctx.setFillStyle(INK);
  ctx.setStrokeStyle(INK);
  const svg = (ctx as unknown as { svg: SVGSVGElement }).svg;
  svg.style.overflow = "visible";

  const perRow = model.barsPerRow;
  const [firstBar, endBar] = rowRange(model, row);
  const nBars = Math.max(0, endBar - firstBar);
  const lastRow = row === model.rows - 1;
  const left = LABEL_W;
  const right = width - 10;
  const { staffs, bpb } = model;
  const isFirstRow = row === 0;

  // 1. Staves (provisional x) + notes.
  const cells: Cell[][] = [];
  for (let i = 0; i < nBars; i++) cells.push(buildColumn(vf, model, row, firstBar + i, i === 0, left));

  // 2. Align beginning modifiers across the system, measure widths.
  if (cells[0]) Stave.formatBegModifiers(cells[0].map((c) => c.stave));
  const formatters = cells.map((col) => {
    const f = new Formatter();
    col.forEach((c) => f.joinVoices([c.voice]));
    return f;
  });
  const minW = cells.map((col, i) => {
    if (!col.length) return 40;
    // what the notes really take (see measureChart); the formatter's own guess runs high
    const measured = measure?.minW[firstBar + i];
    if (measured !== undefined) return measured * SLACK + AIR;
    try {
      return formatters[i].preCalculateMinTotalWidth(col.map((c) => c.voice));
    } catch {
      return 80;
    }
  });
  const modW = cells.map((col) => (col[0] ? col[0].stave.getNoteStartX() - col[0].stave.getX() : 12));
  const PAD = BAR_PAD;
  const base = minW.map((w, i) => w + modW[i] + PAD);
  const fullAvail = right - left;
  // a short last system isn't stretched across the page
  // (`need` is the system's measured width, so it never shrinks below what its notes take)
  const need = measure ? systemWidth(measure, firstBar, endBar) : 0;
  const avail = lastRow && nBars < perRow ? Math.min(fullAvail, Math.max((fullAvail * nBars) / perRow + modW[0], need - left - 10)) : fullAvail;
  const sumBase = base.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (sumBase <= avail) {
    const avgMin = minW.reduce((a, b) => a + b, 0) / Math.max(1, nBars);
    const weights = minW.map((w) => w + avgMin + 20);
    const wsum = weights.reduce((a, b) => a + b, 0);
    widths = base.map((b, i) => b + ((avail - sumBase) * weights[i]) / wsum);
  } else {
    const fixed = modW.reduce((a, b) => a + b, 0) + PAD * nBars;
    const scale = Math.max(0.3, (avail - fixed) / Math.max(1, sumBase - fixed));
    widths = minW.map((w, i) => w * scale + modW[i] + PAD);
  }

  // 3. Position + format.
  let x = left;
  cells.forEach((col, i) => {
    col.forEach((c) => {
      c.stave.setX(x);
      c.stave.setWidth(widths[i]);
    });
    x += widths[i];
  });
  if (cells[0]) Stave.formatBegModifiers(cells[0].map((c) => c.stave));
  cells.forEach((col, i) => {
    if (!col.length) return;
    const st = col[0].stave;
    const justify = Math.max(20, st.getNoteEndX() - st.getNoteStartX() - Stave.defaultPadding);
    try {
      formatters[i].format(
        col.map((c) => c.voice),
        justify,
      );
      formatters[i].postFormat();
    } catch {
      /* SOFT voices that overflow can upset the formatter; draw what we have */
    }
  });

  // 4. Draw staves, connectors, voices, beams, tuplets.
  for (const col of cells) for (const c of col) c.stave.setContext(ctx).draw();

  if (cells[0] && staffs.length) {
    const first = cells[0];
    const top = first[0].stave;
    const bottom = first[first.length - 1].stave;
    if (staffs.length > 1) {
      new StaveConnector(top, bottom).setType("singleLeft").setContext(ctx).draw();
      const nonGrandRun = staffs.filter((s) => !s.grand).length;
      if (nonGrandRun > 1 || (staffs.length > 2 && staffs.some((s) => s.grand))) {
        new StaveConnector(top, bottom).setType("bracket").setContext(ctx).draw();
      }
    }
    staffs.forEach((s, si) => {
      if (s.grand !== "top" || !first[si + 1]) return;
      new StaveConnector(first[si].stave, first[si + 1].stave).setType("brace").setContext(ctx).draw();
    });
  }
  // Grand staff bar lines run through both staves.
  cells.forEach((col) => {
    staffs.forEach((s, si) => {
      if (s.grand !== "top" || !col[si + 1]) return;
      new StaveConnector(col[si].stave, col[si + 1].stave).setType("singleRight").setContext(ctx).draw();
    });
  });

  for (const col of cells) {
    for (const c of col) {
      try {
        c.voice.draw(ctx, c.stave);
        c.beams.forEach((b) => b.setContext(ctx).draw());
        c.tuplets.forEach((t) => t.setContext(ctx).draw());
      } catch {
        /* keep going: one bad bar shouldn't blank the row */
      }
    }
  }

  // 5. Ties (within the row; partial ties at row edges).
  staffs.forEach((_, si) => {
    const flat: { t: Token; n: StaveNoteT }[] = [];
    cells.forEach((col) => col[si]?.tokens.forEach((t, k) => flat.push({ t, n: col[si].notes[k] })));
    flat.forEach(({ t, n }, k) => {
      if (t.kind !== "note") return;
      const idx = t.pitches.map((_, j) => j);
      const drumIdx = staffs[si].drums ? [] : idx;
      if (!drumIdx.length) return;
      try {
        if (t.tiedFrom && k === 0) {
          new StaveTie({ firstNote: null, lastNote: n, firstIndexes: drumIdx, lastIndexes: drumIdx }).setContext(ctx).draw();
        }
        if (t.tieNext) {
          const next = flat[k + 1];
          if (next && next.t.kind === "note") {
            new StaveTie({ firstNote: n, lastNote: next.n, firstIndexes: drumIdx, lastIndexes: drumIdx }).setContext(ctx).draw();
          } else if (!next) {
            new StaveTie({ firstNote: n, lastNote: null, firstIndexes: drumIdx, lastIndexes: drumIdx }).setContext(ctx).draw();
          }
        }
      } catch {
        /* ignore tie failures */
      }
    });
  });

  // Recolour everything VexFlow drew to pencil ink before adding our own marks.
  recolor(svg);

  // 6. Geometry for highlight/seek + anchors for chords and the playhead.
  const geoms: BarGeom[] = cells.map((col, i) => {
    const bar = firstBar + i;
    const st = col[0]?.stave;
    const bx = st ? st.getX() : left;
    const bw = st ? st.getWidth() : widths[i];
    const noteStart = st ? st.getNoteStartX() : bx;
    const noteEnd = st ? st.getNoteEndX() : bx + bw;
    const map = new Map<number, number>();
    for (const c of col) {
      c.tokens.forEach((t, k) => {
        if (t.fullBar) return;
        let nx: number;
        try {
          nx = c.notes[k].getAbsoluteX();
        } catch {
          return;
        }
        if (!Number.isFinite(nx)) return;
        const prev = map.get(t.start);
        map.set(t.start, prev === undefined ? nx : Math.min(prev, nx));
      });
    }
    const anchors: [number, number][] = [...map.entries()].sort((a, b) => a[0] - b[0]);
    if (!anchors.length || anchors[0][0] > 0) anchors.unshift([0, noteStart + 4]);
    anchors.push([bpb * TPB, noteEnd]);
    // Enforce monotonic x.
    for (let k = 1; k < anchors.length; k++) if (anchors[k][1] < anchors[k - 1][1]) anchors[k][1] = anchors[k - 1][1];
    return { bar, row, x: bx, w: bw, anchors };
  });

  // 7. Text: labels, tempo, sections, chord symbols.
  staffs.forEach((s, si) => {
    if (s.grand === "bottom") return;
    const yTop = model.staffY[si];
    const yMid = s.grand === "top" ? (yTop + model.staffY[si + 1] + STAFF_H) / 2 : yTop + STAFF_H / 2;
    if (isFirstRow) {
      addText(svg, left - 12, yMid - 3, s.name, { size: 15, anchor: "end" });
      addText(svg, left - 12, yMid + 13, s.abbr, { size: 12, anchor: "end", fill: INK_SOFT });
    } else {
      addText(svg, left - 12, yMid + 5, s.abbr, { size: 13, anchor: "end", fill: INK_SOFT });
    }
  });

  if (isFirstRow) {
    addText(svg, 6, 22, `♩ = ${model.tempo}`, { size: 16 });
    addText(svg, 6, 40, model.feel, { size: 14, fill: INK_SOFT });
  }

  const topY = model.staffY[0] ?? 80;
  // Chord line sits above whatever the top stave reaches (stems, tuplets), within the header band.
  let highest = topY;
  for (const col of cells) {
    const c = col[0];
    if (!c) continue;
    const inTuplet = new Set(c.tuplets.flatMap((t) => t.getNotes()));
    c.notes.forEach((n, k) => {
      if (c.tokens[k].kind !== "note") return;
      try {
        const bb = n.getBoundingBox();
        let y = bb.getY();
        if (inTuplet.has(n)) y -= 20;
        if (c.tokens[k].art) y -= 8;
        if (Number.isFinite(y)) highest = Math.min(highest, y);
      } catch {
        /* unformatted note */
      }
    });
  }
  const chordY = Math.max(52, Math.min(topY - 18, highest - 8));

  // Bowing marks (pizz. / arco) above the first note that changes technique.
  staffs.forEach((s, si) => {
    if (!s.marks) return;
    cells.forEach((col, i) => {
      const list = s.marks!.get(firstBar + i);
      const c = col[si];
      if (!list || !c) return;
      for (const m of list) {
        const n = c.notes[m.k];
        if (!n) continue;
        let nx: number;
        let ny = model.staffY[si] - 10;
        try {
          nx = n.getAbsoluteX();
          ny = Math.min(ny, n.getBoundingBox().getY() - 6);
        } catch {
          continue;
        }
        addText(svg, nx - 2, ny, m.text, { size: 13, fill: INK_SOFT });
      }
    });
  });
  geoms.forEach((g, i) => {
    const section = model.sectionStarts.get(g.bar);
    if (section) addSection(svg, g.x + (i === 0 ? 2 : 4), 6, section);
    if (i === 0 && g.bar > 0) addText(svg, g.x + 3, topY - 20, String(g.bar + 1), { size: 12, fill: INK_SOFT });
    if (g.bar === model.ritBar) addText(svg, g.x + g.w * 0.45, chordY - 18, "rit.", { size: 15 }).style.fontStyle = "italic";
    for (const ch of model.chords[g.bar] ?? []) {
      const tick = Math.max(0, Math.min(bpb * TPB - 1, Math.round(ch.beat * TPB)));
      addChord(svg, interpolate(g.anchors, tick), chordY, ch.symbol);
    }
  });

  return { row, bars: geoms, renderMs: performance.now() - t0 };
}

export function interpolate(anchors: [number, number][], tick: number): number {
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

function recolor(svg: SVGSVGElement) {
  svg.querySelectorAll("[fill]").forEach((el) => {
    const f = el.getAttribute("fill");
    if (f && f !== "none" && f !== "transparent") el.setAttribute("fill", INK);
  });
  svg.querySelectorAll("[stroke]").forEach((el) => {
    const s = el.getAttribute("stroke");
    if (s && s !== "none" && s !== "transparent") el.setAttribute("stroke", INK);
  });
}

const NS = "http://www.w3.org/2000/svg";

function addText(
  svg: SVGSVGElement,
  x: number,
  y: number,
  text: string,
  opts: { size?: number; anchor?: "start" | "middle" | "end"; fill?: string; weight?: string } = {},
) {
  const el = document.createElementNS(NS, "text");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("fill", opts.fill ?? INK);
  el.setAttribute("text-anchor", opts.anchor ?? "start");
  el.style.fontFamily = TEXT_FONT;
  el.style.fontSize = `${opts.size ?? 14}px`;
  if (opts.weight) el.style.fontWeight = opts.weight;
  el.textContent = text;
  svg.appendChild(el);
  return el;
}

function addChord(svg: SVGSVGElement, x: number, y: number, symbol: string) {
  const c = chordText(symbol);
  const el = document.createElementNS(NS, "text");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("fill", INK);
  el.setAttribute("class", "sheet-chord");
  el.style.fontFamily = TEXT_FONT;
  // Paper halo keeps symbols legible if they brush a stem or bracket.
  el.style.paintOrder = "stroke";
  el.style.stroke = "var(--paper, #f6f0e1)";
  el.style.strokeWidth = "4px";
  el.style.strokeLinejoin = "round";
  el.style.fontSize = "19px";
  const span = (txt: string, size?: number, dy?: number) => {
    if (!txt) return;
    const s = document.createElementNS(NS, "tspan");
    s.textContent = txt;
    if (size) s.style.fontSize = `${size}px`;
    if (dy) s.setAttribute("dy", String(dy));
    el.appendChild(s);
  };
  span(c.root);
  span(c.main, 16);
  if (c.sup) span(c.sup, 13, -7);
  if (c.bass) span(`/${c.bass}`, 16, c.sup ? 7 : 0);
  svg.appendChild(el);
}

function addSection(svg: SVGSVGElement, x: number, y: number, name: string) {
  const g = document.createElementNS(NS, "g");
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", String(x + 7));
  t.setAttribute("y", String(y + 17));
  t.setAttribute("fill", INK);
  t.style.fontFamily = TEXT_FONT;
  t.style.fontSize = "15px";
  t.textContent = name;
  g.appendChild(t);
  svg.appendChild(g);
  let w = name.length * 7.5 + 14;
  try {
    w = t.getComputedTextLength() + 14;
  } catch {
    /* not laid out yet */
  }
  // A slightly wobbly hand-drawn box.
  const h = 24;
  const j = (n: number) => (Math.sin(n * 12.9898 + name.length) * 0.5 + 0.5) * 1.6 - 0.8;
  const d = `M${x + j(1)},${y + j(2)} L${x + w + j(3)},${y + j(4) + 0.6} L${x + w + j(5) - 0.4},${y + h + j(6)} L${x + j(7) + 0.5},${y + h + j(8)} Z`;
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "rgba(226,169,59,0.18)");
  p.setAttribute("stroke", INK);
  p.setAttribute("stroke-width", "1.3");
  p.setAttribute("stroke-linejoin", "round");
  g.insertBefore(p, t);
}
