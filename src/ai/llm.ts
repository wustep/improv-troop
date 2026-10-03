import type { JSONSchema7 } from "ai";
import { useDebug, type LlmCall } from "@/state/debug";
import type { ReasoningLevel } from "./models";

export interface LlmOptions {
  runId: string;
  label: string;
  agent: string;
  model: string;
  system: string;
  prompt: string;
  apiKey: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: ReasoningLevel;
  /** Ask for schema-constrained JSON (falls back to text if the model can't). */
  schema?: JSONSchema7;
  schemaName?: string;
  signal?: AbortSignal;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// A small concurrency gate so a big band doesn't trip gateway rate limits.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquire(signal?: AbortSignal) {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const go = () => {
      inFlight++;
      resolve();
    };
    waiters.push(go);
    signal?.addEventListener("abort", () => {
      const i = waiters.indexOf(go);
      if (i >= 0) waiters.splice(i, 1);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function release() {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

let callSeq = 0;

/** One model call through /api/llm, logged to the debug store with honest timings. */
export async function callLLM(o: LlmOptions): Promise<{ text: string; call: LlmCall }> {
  const debug = useDebug.getState();
  const run = debug.runs.find((r) => r.id === o.runId);
  const base = run?.t0 ?? performance.now();
  const id = `call-${++callSeq}`;
  let call: LlmCall = {
    id,
    runId: o.runId,
    label: o.label,
    agent: o.agent,
    model: o.model,
    system: o.system,
    prompt: o.prompt,
    status: "pending",
    startedAt: performance.now() - base,
    attempt: 1,
    repairs: [],
  };
  debug.upsertCall(call);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (o.signal?.aborted) break;
    await acquire(o.signal);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: o.signal,
        body: JSON.stringify({
          key: o.apiKey,
          model: o.model,
          system: o.system,
          prompt: o.prompt,
          temperature: o.temperature,
          maxOutputTokens: o.maxOutputTokens,
          reasoning: o.reasoning,
          schema: o.schema,
          schemaName: o.schemaName,
        }),
      });
      const data = (await res.json()) as {
        text?: string;
        error?: string;
        usage?: LlmCall["usage"];
        serverMs?: number;
        structured?: boolean;
        fallbackReason?: string;
        params?: LlmCall["params"];
      };
      const ms = performance.now() - t0;
      if (!res.ok || typeof data.text !== "string") {
        throw new LlmError(data.error ?? `HTTP ${res.status}`, res.status);
      }
      call = {
        ...call,
        status: "ok",
        ms,
        serverMs: data.serverMs,
        text: data.text,
        usage: data.usage,
        attempt,
        structured: data.structured,
        params: data.params,
        repairs: data.fallbackReason ? [...call.repairs, `structured output unavailable, parsed text instead (${data.fallbackReason})`] : call.repairs,
      };
      useDebug.getState().upsertCall(call);
      return { text: data.text, call };
    } catch (e) {
      lastErr = e;
      const status = e instanceof LlmError ? e.status : 0;
      const ms = performance.now() - t0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if ((e as Error).name === "AbortError") {
        call = { ...call, status: "error", error: "cancelled", ms, attempt };
        useDebug.getState().upsertCall(call);
        throw e;
      }
      call = { ...call, status: "error", error: (e as Error).message, ms, attempt };
      useDebug.getState().upsertCall(call);
      if (!retryable || attempt === 3 || status === 401 || status === 403) break;
      await new Promise((r) => setTimeout(r, 800 * attempt * attempt + Math.random() * 400));
    } finally {
      release();
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Model call failed");
}

export function noteRepair(callId: string, repair: string) {
  const s = useDebug.getState();
  const c = s.calls.find((x) => x.id === callId);
  if (c) s.patchCall(callId, { repairs: [...c.repairs, repair] });
}

export function setParsed(callId: string, parsed: unknown) {
  useDebug.getState().patchCall(callId, { parsed });
}
