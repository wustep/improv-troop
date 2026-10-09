"use client";

import { create } from "zustand";
import { runComposer, type PipelineHooks } from "@/ai/composer";
import { insertByBar } from "@/ai/talk";
import { startImproviser, type ImprovController } from "@/ai/improviser";
import { notesHintFromScore, troopAudio } from "@/audio/engine";
import { DEFAULT_SOUNDS, readSounds, type Sounds } from "@/audio/packs";
import { defaultStandardLength, snapLength } from "@/music/form";
import { ANIMALS, defaultMembers, INSTRUMENTS } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { getStandard } from "@/music/standards";
import { STYLES, swingAt } from "@/music/styles";
import type { ChatMessage, Member, Score, TroopSettings } from "@/music/types";
import { useDebug } from "./debug";
import { sharedFromHash, type SharedTake } from "./share";
import { addTake, cutShortTake, loadTakes, saveTakes, type Take } from "./takes";

interface GenState {
  running: boolean;
  status: string;
  runId: string | null;
  mode: TroopSettings["mode"] | null;
  error: string | null;
}

interface TroopState {
  hydrated: boolean;
  members: Member[];
  settings: TroopSettings;
  apiKey: string;
  /** The server has its own gateway key (IMPROV_TROOP_SERVER_KEY), so the band can think without one here. */
  serverKey: boolean;
  /** Which piano and drum kit the band plays (saved in this browser). */
  sounds: Sounds;
  current: Score | null;
  /** True when `current` is the local sketch for the current settings. */
  isSketch: boolean;
  takes: Take[];
  gen: GenState;
  chat: ChatMessage[];
  playing: boolean;
  playToken: number;
  /** Why the last press of play didn't start the sound (cleared on the next play or stop). */
  audioError: string | null;
  /** Members silenced in the mix (tap a name tag on stage). */
  muted: string[];
  /** While the band is still improvising: bars ready from the top (null when the chart is complete). */
  readyBars: number | null;
  /** Bars the band vamped through on autopilot (live improv). */
  autopilotBars: number[];
  /** First-visit hints dismissed. */
  seenIntro: boolean;
  /** Just arrived from a share link: the take it carried (cleared on play or dismiss). */
  sharedArrival: { takeId: string } | null;
  hydrate(): void;
  toggleMute(id: string): void;
  deleteTake(id: string): void;
  dismissIntro(): void;
  dismissArrival(): void;
  /** Make the shared take's band and settings your own, to jam on from there. */
  adoptSharedBand(): void;
  setSettings(patch: Partial<TroopSettings>): void;
  setStyle(style: TroopSettings["style"]): void;
  setStandard(id: string | null): void;
  setMembers(members: Member[]): void;
  setApiKey(key: string): void;
  setSounds(patch: Partial<Sounds>): void;
  generate(): Promise<void>;
  cancel(): void;
  /** After a failed model run: drop the error and play the local band's take for these settings. */
  playSketchInstead(): void;
  play(fromBar?: number): Promise<void>;
  stop(): void;
  selectTake(id: string): void;
}

const LS = "improv-troop:v1";
const LS_INTRO = "jamming:intro-seen";

function load(): Partial<Pick<TroopState, "members" | "settings" | "apiKey" | "sounds">> & { pianoPack?: unknown } {
  try {
    const raw = localStorage.getItem(LS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(s: Pick<TroopState, "members" | "settings" | "apiKey" | "sounds">) {
  try {
    localStorage.setItem(LS, JSON.stringify({ members: s.members, settings: s.settings, apiKey: s.apiKey, sounds: s.sounds }));
  } catch {
    /* private mode etc. */
  }
}

/** Keep settings coherent with the band (leader/soloists must exist, leader can't be the drummer). */
function reconcile(settings: TroopSettings, members: Member[]): TroopSettings {
  const ids = new Set(members.map((m) => m.id));
  const leaderOk = (id: string) => ids.has(id) && members.find((m) => m.id === id)?.instrument !== "drums";
  let leaderId = settings.leaderId;
  if (!leaderOk(leaderId)) {
    leaderId =
      members.find((m) => INSTRUMENTS[m.instrument].fn === "melodic")?.id ??
      members.find((m) => m.instrument !== "drums")?.id ??
      members[0]?.id ??
      "";
  }
  const soloists = settings.soloists.filter((id) => ids.has(id));
  const bars = snapLength(settings.standard, settings.bars);
  return { ...settings, leaderId, soloists, bars };
}

/**
 * The chart at another tempo or swing feel. Both are playback dials: the plan and the notes stay
 * as they are, and the swing follows the tempo the way the style does (a fast tune swings flatter).
 */
function atPlayback(score: Score, tempo: number, swingFeel = score.settings.swingFeel): Score {
  const swing = swingAt(STYLES[score.settings.style], tempo, swingFeel);
  if (score.frame.tempo === tempo && score.settings.tempo === tempo && score.settings.swingFeel === swingFeel && score.swing === swing) return score;
  return { ...score, swing, settings: { ...score.settings, tempo, swingFeel }, frame: { ...score.frame, tempo } };
}

let controller: AbortController | null = null;
let improv: ImprovController | null = null;
let liveTimer: ReturnType<typeof setInterval> | null = null;
let endedUnsub: (() => void) | null = null;
let failedUnsub: (() => void) | null = null;

function stopLiveWatch() {
  if (liveTimer !== null) clearInterval(liveTimer);
  liveTimer = null;
}

export const useTroop = create<TroopState>((set, get) => {
  const sketch = () => {
    const { settings, members } = get();
    if (!members.length) {
      set({ current: null, isSketch: true });
      return;
    }
    const t0 = performance.now();
    const { score, issues, timings } = generateLocal(settings, members);
    const runId = `sketch-${score.id}`;
    const dbg = useDebug.getState();
    dbg.startRun(runId, "local sketch");
    dbg.timing(runId, "frame", timings.frameMs);
    dbg.timing(runId, "plan", timings.planMs);
    dbg.timing(runId, "realize", timings.realizeMs);
    dbg.timing(runId, "total", performance.now() - t0);
    dbg.endRun(runId, "done", issues);
    const wasPlaying = get().playing;
    set({ current: score, isSketch: true, chat: [] });
    // switching character while playing starts the new chart
    if (wasPlaying) void get().play();
    else void troopAudio.prepare(members, { sounds: get().sounds, notesHint: notesHintFromScore(score) });
  };

  // A shared link (#t=…): replay that take without touching the visitor's own band.
  const openSharedLink = () => {
    let shared: SharedTake | null = null;
    try {
      shared = sharedFromHash(location.hash);
      if (/[#&]t=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    } catch {
      /* ignore */
    }
    if (!shared) return;
    if (get().playing) get().stop();
    const settings = reconcile({ ...defaultSettings(shared.members), ...shared.settings }, shared.members);
    const { score } = generateLocal(settings, shared.members);
    const take: Take = { id: score.id, score, label: `Shared · ${STYLES[settings.style].name}`, engine: "local", createdAt: Date.now() };
    set((s) => ({ current: score, isSketch: false, takes: addTake(s.takes, take), chat: [], sharedArrival: { takeId: take.id } }));
    saveTakes(get().takes);
    void troopAudio.prepare(score.members, { sounds: get().sounds, notesHint: notesHintFromScore(score) });
  };

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    save(get());
  };
  const persistSoon = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 300);
  };

  return {
    hydrated: false,
    members: defaultMembers(),
    settings: defaultSettings(defaultMembers()),
    apiKey: "",
    serverKey: false,
    sounds: DEFAULT_SOUNDS,
    current: null,
    isSketch: true,
    takes: [],
    gen: { running: false, status: "", runId: null, mode: null, error: null },
    chat: [],
    playing: false,
    playToken: 0,
    audioError: null,
    muted: [],
    readyBars: null,
    autopilotBars: [],
    seenIntro: true,
    sharedArrival: null,

    hydrate() {
      if (get().hydrated) return;
      const saved = load();
      const members = saved.members?.length ? saved.members.filter((m) => ANIMALS[m.animal] && INSTRUMENTS[m.instrument]) : get().members;
      const settings = reconcile({ ...defaultSettings(members), ...(saved.settings ?? {}) }, members);
      let seenIntro = true;
      try {
        seenIntro = localStorage.getItem(LS_INTRO) === "1";
      } catch {
        /* ignore */
      }
      set({ hydrated: true, members, settings, apiKey: saved.apiKey ?? "", sounds: readSounds(saved.sounds, saved.pianoPack), takes: loadTakes(), seenIntro });
      void fetch("/api/llm")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { serverKey?: boolean } | null) => set({ serverKey: !!d?.serverKey }))
        .catch(() => {});
      endedUnsub?.();
      endedUnsub = troopAudio.onEnded(() => {
        stopLiveWatch();
        set({ playing: false });
      });
      failedUnsub?.();
      failedUnsub = troopAudio.onFailed((audioError) => {
        stopLiveWatch();
        set({ playing: false, audioError });
      });
      sketch();
      // reloaded mid-jam: back to that jam, with what the band said, rather than a sketch of its seed
      const top = get().takes[0];
      if (top?.cutAt !== undefined && top.score.settings.seed === settings.seed && top.score.settings.style === settings.style) {
        set({ current: top.score, isSketch: false, chat: top.score.chat });
        void troopAudio.prepare(top.score.members, { sounds: get().sounds, notesHint: notesHintFromScore(top.score) });
      }
      openSharedLink();
      // a link pasted into a tab that's already open only changes the hash
      window.addEventListener("hashchange", openSharedLink);
    },

    setSettings(patch) {
      const structural = Object.keys(patch).some((k) => !["tempo", "swingFeel", "bestOf", "directorModel", "playerModel", "mode", "phraseBars"].includes(k));
      const settings = reconcile({ ...get().settings, ...patch }, get().members);
      set({ settings });
      // the tempo slider fires on every pixel of a drag: save once it settles
      if (patch.tempo !== undefined && !structural) persistSoon();
      else persist();
      if (structural) {
        sketch();
      } else if (patch.tempo !== undefined || "swingFeel" in patch) {
        // tempo and swing are playback dials: apply them to the chart on screen without re-planning it
        const cur = get().current;
        if (cur) {
          const next = atPlayback(cur, settings.tempo, settings.swingFeel);
          set({ current: next });
          // re-tempo in place; restart from this bar only if the transport can't (e.g. mid count-in)
          if (get().playing && !troopAudio.setTempo(next)) {
            const beat = troopAudio.getBeat();
            const bar = Number.isFinite(beat) && beat > 0 ? Math.floor(beat / next.frame.meter.beats) : 0;
            troopAudio.play(next, { fromBar: bar, countIn: false });
          }
        }
      }
    },

    setStyle(style) {
      const s = STYLES[style];
      const std = getStandard(get().settings.standard);
      const patch: Partial<TroopSettings> = { style, tempo: s.tempo.default };
      if (!std) patch.key = { ...s.key };
      get().setSettings(patch);
    },

    setStandard(id) {
      const std = getStandard(id);
      const patch: Partial<TroopSettings> = { standard: id };
      if (std) {
        patch.key = { ...std.key };
        patch.meter = { beats: std.meter };
        patch.style = std.style;
        patch.tempo = std.tempo;
        // a chorus for each soloist (the drummer's turn is a trading chorus)
        const { settings, members } = get();
        const soloists = settings.soloists.filter((sid) => members.some((m) => m.id === sid));
        patch.bars = defaultStandardLength(id, soloists.length);
      } else {
        patch.bars = 16;
      }
      get().setSettings(patch);
    },

    setMembers(members) {
      const settings = reconcile(get().settings, members);
      set({ members, settings });
      persist();
      sketch();
    },

    setApiKey(apiKey) {
      set({ apiKey: apiKey.trim() });
      persist();
    },

    setSounds(patch) {
      const sounds = { ...get().sounds, ...patch };
      set({ sounds });
      persist();
      void troopAudio.prepare(get().members, { sounds });
    },

    async generate() {
      const st = get();
      if (st.gen.running) return;
      const members = st.members;
      if (!members.length) return;
      const settings: TroopSettings = { ...st.settings, seed: Math.floor(Math.random() * 1e9) };
      set({ settings });
      persist();

      // No key: the stub band plays a fresh local take.
      if (!st.apiKey && !st.serverKey) {
        const { score } = generateLocal(settings, members);
        const take: Take = { id: score.id, score, label: `${STYLES[settings.style].name} sketch`, engine: "local", createdAt: Date.now() };
        set((s) => ({ current: score, isSketch: false, takes: addTake(s.takes, take), chat: [], readyBars: null, autopilotBars: [] }));
        saveTakes(get().takes);
        void get().play();
        return;
      }

      controller?.abort();
      controller = new AbortController();
      const runId = `run-${Date.now().toString(36)}`;
      useDebug.getState().startRun(runId, settings.mode);
      set({ gen: { running: true, status: "Tuning up…", runId, mode: settings.mode, error: null }, chat: [], readyBars: settings.mode === "improviser" ? 0 : null, autopilotBars: [] });
      void troopAudio.unlock().catch(() => {});
      void troopAudio.prepare(members, { sounds: st.sounds });

      const label = `${STYLES[settings.style].name} · ${settings.mode === "composer" ? "composed" : "jammed"}`;
      let cutShort: Take | null = null;
      const hooks: PipelineHooks = {
        runId,
        apiKey: st.apiKey,
        signal: controller.signal,
        onStatus: (status) => set((s) => ({ gen: { ...s.gen, status } })),
        onChat: (msg) => set((s) => ({ chat: insertByBar(s.chat, msg) })),
        onScore: (phrase) => {
          // the band planned at the tempo they were asked for: keep any change made since
          const score = atPlayback(phrase, get().settings.tempo, get().settings.swingFeel);
          // a reload mid-jam comes back to this jam (finish replaces it under the same id)
          if (improv && improv.readyBars() > 0) {
            cutShort = cutShortTake(score, improv.readyBars(), label);
            saveTakes(addTake(get().takes, cutShort));
          }
          // live improv: start the band as soon as the first phrase is down
          set({
            current: score,
            isSketch: false,
            readyBars: improv ? improv.readyBars() : null,
            autopilotBars: improv ? improv.autopilotBars() : [],
          });
          if (get().playing) troopAudio.updateScore(score);
          else if (improv && improv.readyBars() > 0 && !get().playing) {
            // start as soon as the band can stay ahead of the playhead at the pace it's thinking
            if (improv.readyToPlay(60 / score.frame.tempo)) void get().play();
            else set((s) => ({ gen: { ...s.gen, status: `${s.gen.status.replace(/ · .*$/, "")} · getting a phrase ahead before we start…` } }));
          }
        },
      };

      const finish = (done: Score) => {
        const score = atPlayback(done, get().settings.tempo, get().settings.swingFeel);
        const take: Take = { id: score.id, score, label, engine: "ai", createdAt: Date.now() };
        set((s) => ({
          current: score,
          isSketch: false,
          takes: addTake(s.takes, take),
          readyBars: null,
          gen: { running: false, status: "", runId, mode: settings.mode, error: null },
          chat: score.chat,
        }));
        saveTakes(get().takes);
        if (get().playing) troopAudio.updateScore(score);
        else void get().play();
      };

      try {
        if (settings.mode === "composer") {
          const score = await runComposer(settings, members, hooks);
          finish(score);
        } else {
          improv = startImproviser(settings, members, hooks);
          const score = await improv.promise;
          finish(score);
        }
      } catch (e) {
        const err = e as Error;
        const cancelled = err.name === "AbortError";
        useDebug.getState().endRun(runId, cancelled ? "cancelled" : "error");
        set({ gen: { running: false, status: "", runId, mode: settings.mode, error: cancelled ? null : err.message }, readyBars: null });
        // what the band got through stays a take, as it already is after a reload
        const kept = cutShort;
        if (kept) set((s) => ({ takes: addTake(s.takes, kept) }));
      } finally {
        improv = null;
      }
    },

    cancel() {
      controller?.abort();
      controller = null;
    },

    playSketchInstead() {
      set((s) => ({ gen: { ...s.gen, error: null } }));
      sketch();
      if (!get().playing) void get().play();
    },

    async play(fromBar = 0) {
      const score = get().current;
      if (!score) return;
      if (get().audioError) set({ audioError: null });
      let started = false;
      try {
        await troopAudio.unlock();
        void troopAudio.prepare(score.members, { sounds: get().sounds, notesHint: notesHintFromScore(score) });
        for (const m of score.members) troopAudio.setMute(m.id, get().muted.includes(m.id));
        started = troopAudio.play(score, { fromBar, countIn: fromBar === 0 && get().sounds.countIn });
      } catch (e) {
        console.error("[troop] play failed", e);
      }
      if (!started) {
        troopAudio.stop();
        stopLiveWatch();
        set({ playing: false, audioError: "this browser won't play sound here" });
        return;
      }
      set((s) => ({ playing: true, playToken: s.playToken + 1 }));
      if (!get().seenIntro) get().dismissIntro();
      if (get().sharedArrival) set({ sharedArrival: null });
      // live improv watchdog: if playback catches up with the band's thinking, they vamp on autopilot
      stopLiveWatch();
      // A timer, not rAF: rAF pauses in a background tab but the audio keeps playing, and the
      // band has to keep up there too. Hidden tabs throttle timers to ~1s, so look further ahead.
      const tick = () => {
        if (!get().playing) return stopLiveWatch();
        if (!improv) return;
        const beats = score.frame.meter.beats;
        const beat = troopAudio.getBeat();
        const ready = improv.readyBars();
        const margin = Math.max(beats * 0.75, document.hidden ? 1.6 / troopAudio.getSecondsPerBeat() : 0);
        if (Number.isFinite(beat) && ready < score.frame.bars && beat > ready * beats - margin) {
          if (improv.ensureReady(ready)) {
            const cur = get().current;
            if (cur) troopAudio.updateScore(cur);
            set({ readyBars: improv.readyBars(), autopilotBars: improv.autopilotBars() });
          }
        }
      };
      liveTimer = setInterval(tick, 100);
    },

    stop() {
      troopAudio.stop();
      stopLiveWatch();
      set({ playing: false, audioError: null });
    },

    toggleMute(id) {
      const muted = get().muted.includes(id) ? get().muted.filter((x) => x !== id) : [...get().muted, id];
      troopAudio.setMute(id, muted.includes(id));
      set({ muted });
    },

    deleteTake(id) {
      const takes = get().takes.filter((t) => t.id !== id);
      set({ takes });
      saveTakes(takes);
    },

    dismissArrival() {
      set({ sharedArrival: null });
    },

    adoptSharedBand() {
      const take = get().takes.find((t) => t.id === get().sharedArrival?.takeId);
      set({ sharedArrival: null });
      if (!take) return;
      const { members, settings: from } = take.score;
      const { style, bars, tempo, key, meter, standard, leaderId, soloists, seed, phraseBars } = from;
      // only the musical choices: the visitor keeps their own mode, models and key
      const settings = reconcile({ ...get().settings, style, bars, tempo, key, meter, standard, leaderId, soloists, seed, phraseBars }, members);
      set({ members, settings });
      persist();
      // the same settings and seed, so the sketch is the take they were sent
      sketch();
    },

    dismissIntro() {
      set({ seenIntro: true });
      try {
        localStorage.setItem(LS_INTRO, "1");
      } catch {
        /* ignore */
      }
    },

    selectTake(id) {
      const take = get().takes.find((t) => t.id === id);
      if (!take) return;
      set({ current: take.score, isSketch: false, chat: take.score.chat });
      if (get().playing) void get().play();
    },
  };
});

/** The band can call models: a key in this browser, or one the server lends. */
export const canThink = (s: Pick<TroopState, "apiKey" | "serverKey">) => !!s.apiKey || s.serverKey;
