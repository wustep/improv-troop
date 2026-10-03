"use client";

import { create } from "zustand";
import { runComposer, type PipelineHooks } from "@/ai/composer";
import { startImproviser, type ImprovController } from "@/ai/improviser";
import { notesHintFromScore, troopAudio, type PianoPack } from "@/audio/engine";
import { snapLength } from "@/music/form";
import { ANIMALS, defaultMembers, INSTRUMENTS } from "@/music/instruments";
import { defaultSettings, generateLocal } from "@/music/local";
import { getStandard } from "@/music/standards";
import { STYLES } from "@/music/styles";
import type { ChatMessage, Member, Score, TroopSettings } from "@/music/types";
import { useDebug } from "./debug";

export interface Take {
  id: string;
  score: Score;
  label: string;
  engine: "local" | "ai";
  createdAt: number;
}

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
  pianoPack: PianoPack;
  current: Score | null;
  /** True when `current` is the local sketch for the current settings. */
  isSketch: boolean;
  takes: Take[];
  gen: GenState;
  chat: ChatMessage[];
  playing: boolean;
  playToken: number;
  hydrate(): void;
  setSettings(patch: Partial<TroopSettings>): void;
  setStyle(style: TroopSettings["style"]): void;
  setStandard(id: string | null): void;
  setMembers(members: Member[]): void;
  setApiKey(key: string): void;
  setPianoPack(p: PianoPack): void;
  generate(): Promise<void>;
  cancel(): void;
  play(fromBar?: number): Promise<void>;
  stop(): void;
  selectTake(id: string): void;
}

const LS = "improv-troop:v1";

function load(): Partial<Pick<TroopState, "members" | "settings" | "apiKey" | "pianoPack">> {
  try {
    const raw = localStorage.getItem(LS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(s: Pick<TroopState, "members" | "settings" | "apiKey" | "pianoPack">) {
  try {
    localStorage.setItem(LS, JSON.stringify({ members: s.members, settings: s.settings, apiKey: s.apiKey, pianoPack: s.pianoPack }));
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

let controller: AbortController | null = null;
let improv: ImprovController | null = null;
let liveTimer: number | null = null;
let endedUnsub: (() => void) | null = null;

function stopLiveWatch() {
  if (liveTimer !== null) cancelAnimationFrame(liveTimer);
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
    else void troopAudio.prepare(members, { pianoPack: get().pianoPack, notesHint: notesHintFromScore(score) });
  };

  const persist = () => save(get());

  return {
    hydrated: false,
    members: defaultMembers(),
    settings: defaultSettings(defaultMembers()),
    apiKey: "",
    pianoPack: "salamander",
    current: null,
    isSketch: true,
    takes: [],
    gen: { running: false, status: "", runId: null, mode: null, error: null },
    chat: [],
    playing: false,
    playToken: 0,

    hydrate() {
      if (get().hydrated) return;
      const saved = load();
      const members = saved.members?.length ? saved.members.filter((m) => ANIMALS[m.animal] && INSTRUMENTS[m.instrument]) : get().members;
      const settings = reconcile({ ...defaultSettings(members), ...(saved.settings ?? {}) }, members);
      set({ hydrated: true, members, settings, apiKey: saved.apiKey ?? "", pianoPack: saved.pianoPack ?? "salamander" });
      endedUnsub?.();
      endedUnsub = troopAudio.onEnded(() => {
        stopLiveWatch();
        set({ playing: false });
      });
      sketch();
    },

    setSettings(patch) {
      const structural = Object.keys(patch).some((k) => !["tempo", "bestOf", "directorModel", "playerModel", "mode", "phraseBars"].includes(k));
      const settings = reconcile({ ...get().settings, ...patch }, get().members);
      set({ settings });
      persist();
      if (structural) {
        sketch();
      } else if (patch.tempo !== undefined) {
        // tempo is a playback dial: apply to the chart on screen without re-planning it
        const cur = get().current;
        if (cur) {
          const next: Score = { ...cur, settings: { ...cur.settings, tempo: settings.tempo }, frame: { ...cur.frame, tempo: settings.tempo } };
          set({ current: next });
          if (get().playing) {
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
        patch.bars = snapLength(id, get().settings.bars);
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

    setPianoPack(pianoPack) {
      set({ pianoPack });
      persist();
      void troopAudio.prepare(get().members, { pianoPack });
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
      if (!st.apiKey) {
        const { score } = generateLocal(settings, members);
        const take: Take = { id: score.id, score, label: `${STYLES[settings.style].name} sketch`, engine: "local", createdAt: Date.now() };
        set((s) => ({ current: score, isSketch: false, takes: [take, ...s.takes].slice(0, 12), chat: [] }));
        void get().play();
        return;
      }

      controller?.abort();
      controller = new AbortController();
      const runId = `run-${Date.now().toString(36)}`;
      useDebug.getState().startRun(runId, settings.mode);
      set({ gen: { running: true, status: "Tuning up…", runId, mode: settings.mode, error: null }, chat: [] });
      void troopAudio.unlock().catch(() => {});
      void troopAudio.prepare(members, { pianoPack: st.pianoPack });

      const hooks: PipelineHooks = {
        runId,
        apiKey: st.apiKey,
        signal: controller.signal,
        onStatus: (status) => set((s) => ({ gen: { ...s.gen, status } })),
        onChat: (msg) => set((s) => ({ chat: [...s.chat, msg] })),
        onScore: (score) => {
          // live improv: start the band as soon as the first phrase is down
          set({ current: score, isSketch: false });
          if (get().playing) troopAudio.updateScore(score);
          else if (improv && improv.readyBars() > 0 && !get().playing) void get().play();
        },
      };

      const finish = (score: Score) => {
        const label = `${STYLES[settings.style].name} · ${settings.mode === "composer" ? "composed" : "jammed"}`;
        const take: Take = { id: score.id, score, label, engine: "ai", createdAt: Date.now() };
        set((s) => ({
          current: score,
          isSketch: false,
          takes: [take, ...s.takes.filter((t) => t.id !== score.id)].slice(0, 12),
          gen: { running: false, status: "", runId, mode: settings.mode, error: null },
          chat: score.chat,
        }));
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
        set({ gen: { running: false, status: "", runId, mode: settings.mode, error: cancelled ? null : err.message } });
      } finally {
        improv = null;
      }
    },

    cancel() {
      controller?.abort();
      controller = null;
    },

    async play(fromBar = 0) {
      const score = get().current;
      if (!score) return;
      await troopAudio.unlock();
      void troopAudio.prepare(score.members, { pianoPack: get().pianoPack, notesHint: notesHintFromScore(score) });
      troopAudio.play(score, { fromBar, countIn: fromBar === 0 });
      set((s) => ({ playing: true, playToken: s.playToken + 1 }));
      // live improv watchdog: if playback catches up with the band's thinking, they vamp on autopilot
      stopLiveWatch();
      const tick = () => {
        if (!get().playing) return;
        if (improv) {
          const beats = score.frame.meter.beats;
          const beat = troopAudio.getBeat();
          const ready = improv.readyBars();
          if (Number.isFinite(beat) && ready < score.frame.bars && beat > ready * beats - beats * 0.75) {
            if (improv.ensureReady(ready)) {
              const cur = get().current;
              if (cur) troopAudio.updateScore(cur);
            }
          }
        }
        liveTimer = requestAnimationFrame(tick);
      };
      liveTimer = requestAnimationFrame(tick);
    },

    stop() {
      troopAudio.stop();
      stopLiveWatch();
      set({ playing: false });
    },

    selectTake(id) {
      const take = get().takes.find((t) => t.id === id);
      if (!take) return;
      set({ current: take.score, isSketch: false, chat: take.score.chat });
      if (get().playing) void get().play();
    },
  };
});
