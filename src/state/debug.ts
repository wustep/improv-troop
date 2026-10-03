import { create } from "zustand";
import type { RealizeIssue } from "@/music/realize";

export interface LlmCall {
  id: string;
  runId: string;
  label: string;
  /** "director", "critic", or a member id. */
  agent: string;
  model: string;
  system: string;
  prompt: string;
  status: "pending" | "ok" | "error";
  /** Wall-clock ms measured in the browser (request → parsed response). */
  ms?: number;
  /** ms spent inside the server route (model latency). */
  serverMs?: number;
  startedAt: number; // performance.now() at start (relative to run start)
  text?: string;
  error?: string;
  usage?: { inputTokens: number | null; outputTokens: number | null };
  attempt: number;
  /** Notes from parsing/validation: what we repaired or fell back on. */
  repairs: string[];
  parsed?: unknown;
}

export interface RunLog {
  id: string;
  mode: string;
  startedAt: number; // Date.now()
  t0: number; // performance.now()
  endedAt?: number; // performance.now()
  status: "running" | "done" | "error" | "cancelled";
  steps: { t: number; text: string }[];
  timings: Record<string, number>;
  issues: RealizeIssue[];
}

interface DebugState {
  open: boolean;
  calls: LlmCall[];
  runs: RunLog[];
  setOpen(open: boolean): void;
  startRun(id: string, mode: string): void;
  step(runId: string, text: string): void;
  timing(runId: string, key: string, ms: number): void;
  endRun(runId: string, status: RunLog["status"], issues?: RealizeIssue[]): void;
  upsertCall(call: LlmCall): void;
  patchCall(id: string, patch: Partial<LlmCall>): void;
  clear(): void;
}

export const useDebug = create<DebugState>((set) => ({
  open: false,
  calls: [],
  runs: [],
  setOpen: (open) => set({ open }),
  startRun: (id, mode) =>
    set((s) => ({
      runs: [
        { id, mode, startedAt: Date.now(), t0: performance.now(), status: "running" as const, steps: [], timings: {}, issues: [] },
        ...s.runs,
      ].slice(0, 12),
    })),
  step: (runId, text) =>
    set((s) => ({
      runs: s.runs.map((r) => (r.id === runId ? { ...r, steps: [...r.steps, { t: performance.now() - r.t0, text }] } : r)),
    })),
  timing: (runId, key, ms) =>
    set((s) => ({ runs: s.runs.map((r) => (r.id === runId ? { ...r, timings: { ...r.timings, [key]: ms } } : r)) })),
  endRun: (runId, status, issues) =>
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId ? { ...r, status, endedAt: performance.now(), issues: issues ?? r.issues } : r,
      ),
    })),
  upsertCall: (call) =>
    set((s) => {
      const i = s.calls.findIndex((c) => c.id === call.id);
      if (i < 0) return { calls: [...s.calls, call].slice(-300) };
      const calls = [...s.calls];
      calls[i] = call;
      return { calls };
    }),
  patchCall: (id, patch) =>
    set((s) => ({ calls: s.calls.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  clear: () => set({ calls: [], runs: [] }),
}));
