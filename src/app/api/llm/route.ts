import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway, generateText, jsonSchema, Output, type JSONSchema7 } from "ai";
import { anthropicModelId, isClaude, pickRoute, type Route } from "@/ai/keys";
import { fakeModel } from "@/ai/mock";
import { callParams, type ReasoningLevel } from "@/ai/models";

// Thin proxy to the Vercel AI Gateway, or straight to Anthropic for Claude models. The browser
// orchestrates the band (so the debug panel sees every step); each call here is one short model request.
//
// Keys: the visitor's own gateway or Anthropic key from the request, used for this call only and
// never logged or stored. Server-side keys are only used when IMPROV_TROOP_SERVER_KEY (gateway) or
// ANTHROPIC_API_KEY is set explicitly — we never fall back to ambient Vercel OIDC credentials, so a
// public deployment can't spend the owner's credits. Which key wins is in src/ai/keys.ts.
//
// Structured output: when the client sends a JSON schema the model is asked for an
// object matching it. If the model or provider rejects that, we retry once as plain
// text and the client's tolerant JSON parser takes over.

export const maxDuration = 120;

// Thinking counts against maxOutputTokens with every provider, so a step's budget is for its
// answer and reasoning gets room on top. Without it Haiku spent a count-off's 1200 tokens
// thinking and the plan came back cut off mid-JSON.
const THINKING_ROOM: Record<ReasoningLevel, number> = { none: 0, minimal: 1024, low: 2048, medium: 4096, high: 8192 };

const MODEL_RE = /^[a-z0-9-]+\/[a-z0-9.\-]+$/i;

const PROVIDER = { gateway: "The AI Gateway", anthropic: "Anthropic" } as const;

function keyRejected(r: Route) {
  return r.from === "browser"
    ? `${PROVIDER[r.via]} rejected your ${r.via === "gateway" ? "AI Gateway" : "Anthropic"} key — check it in “Brains & sounds”.`
    : `${PROVIDER[r.via]} rejected this server's ${r.via === "gateway" ? "gateway" : "Anthropic"} key — add your own in “Brains & sounds”.`;
}

const rateLimited = (r: Route) => `Rate limited by ${r.via === "gateway" ? "the AI Gateway" : "Anthropic"} — try again in a moment.`;

const serverKeys = () => ({ gateway: process.env.IMPROV_TROOP_SERVER_KEY, anthropic: process.env.ANTHROPIC_API_KEY });

interface Body {
  /** The visitor's AI Gateway key. */
  key?: string;
  /** The visitor's Anthropic key, for Claude models. */
  anthropicKey?: string;
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: ReasoningLevel;
  schema?: JSONSchema7;
  schemaName?: string;
}

type CallError = { message?: string; statusCode?: number; status?: number; name?: string };

// After its retries the SDK throws a RetryError; the status lives on the last attempt's error.
const callError = (e: unknown) => ((e as { lastError?: CallError }).lastError ?? e) as CallError;

// The client cancelled (Cancel in the UI aborts the browser fetch, which closes the request).
// Nobody is listening for the body, so the status is only for logs.
const CANCELLED = () => new Response(null, { status: 499 });

function isAuthError(e: CallError) {
  const status = e.statusCode ?? e.status ?? 0;
  return status === 401 || status === 403 || /unauthenticated|invalid api key|authentication/i.test(e.message ?? "");
}

/** Which keys this server lends the band (never the keys themselves), so the UI can let them think without one. */
export async function GET() {
  const s = serverKeys();
  return Response.json({ serverKey: !!s.gateway?.trim(), serverAnthropicKey: !!s.anthropic?.trim() });
}

export async function POST(req: Request) {
  const t0 = performance.now();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON body" }, { status: 400 });
  }
  // Local development only: key "mock" (or "mock:<ms>" for a given latency, in either key field) answers with a
  // canned band so the UI flow can be exercised offline.
  const mock = process.env.NODE_ENV !== "production" ? /^mock(?::(\d+))?$/.exec(body.key || body.anthropicKey || "") : null;
  if (mock) {
    const ms = mock[1] ? +mock[1] : 400 + Math.random() * 900;
    await new Promise<void>((r) => {
      const t = setTimeout(r, ms * (0.8 + Math.random() * 0.4));
      req.signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
    });
    if (req.signal.aborted) return CANCELLED();
    return Response.json({ text: fakeModel(body), structured: false, usage: { inputTokens: 0, outputTokens: 0 }, serverMs: performance.now() - t0 });
  }
  if (!MODEL_RE.test(body.model ?? "")) return Response.json({ error: `Unknown model "${body.model}"` }, { status: 400 });
  const route = pickRoute(body.model, { gateway: body.key, anthropic: body.anthropicKey }, serverKeys());
  if (!route) {
    const anyKey = [body.key, body.anthropicKey, ...Object.values(serverKeys())].some((k) => k?.trim());
    return anyKey && !isClaude(body.model)
      ? Response.json({ error: `${body.model} needs an AI Gateway key. With only an Anthropic key, pick a Claude model in “Brains & sounds”.` }, { status: 400 })
      : Response.json({ error: "Add an AI Gateway or Anthropic key in “Brains & sounds” to let the band think." }, { status: 401 });
  }
  if (!body.prompt || body.prompt.length > 60_000 || (body.system?.length ?? 0) > 30_000) {
    return Response.json({ error: "Prompt missing or too long" }, { status: 400 });
  }

  const model =
    route.via === "anthropic" ? createAnthropic({ apiKey: route.apiKey })(anthropicModelId(body.model)) : createGateway({ apiKey: route.apiKey })(body.model);
  // only send what this model accepts (e.g. Claude Sonnet 5.5 takes no temperature)
  const params = callParams(body.model, { temperature: body.temperature, reasoning: body.reasoning, schema: !!body.schema });
  const base = {
    model,
    system: body.system,
    prompt: body.prompt,
    maxOutputTokens: Math.min(body.maxOutputTokens ?? 2000, 8000) + (params.reasoning ? (THINKING_ROOM[params.reasoning] ?? 4096) : 0),
    maxRetries: 1,
    ...params,
  };
  // Stop the model call when the browser goes away, so a cancelled run doesn't keep
  // spending the user's key until the timeout.
  const abortSignal = () => AbortSignal.any([req.signal, AbortSignal.timeout(100_000)]);
  const usage = (u: { inputTokens?: number; outputTokens?: number } | undefined) => ({
    inputTokens: u?.inputTokens ?? null,
    outputTokens: u?.outputTokens ?? null,
  });

  let fallbackReason: string | undefined;
  if (body.schema && typeof body.schema === "object") {
    try {
      const result = await generateText({
        ...base,
        abortSignal: abortSignal(),
        output: Output.object({ schema: jsonSchema(body.schema), name: body.schemaName }),
      });
      return Response.json({
        text: JSON.stringify(result.output),
        structured: true,
        finishReason: result.finishReason,
        usage: usage(result.usage),
        params,
        via: route.via,
        serverMs: performance.now() - t0,
      });
    } catch (e) {
      if (req.signal.aborted) return CANCELLED();
      const err = callError(e);
      if (isAuthError(err)) return Response.json({ error: keyRejected(route) }, { status: 401 });
      if ((err.statusCode ?? err.status) === 429) return Response.json({ error: rateLimited(route) }, { status: 429 });
      fallbackReason = (err.message ?? "structured output failed").slice(0, 240);
    }
  }

  try {
    const result = await generateText({ ...base, abortSignal: abortSignal() });
    return Response.json({
      text: result.text,
      structured: false,
      fallbackReason,
      finishReason: result.finishReason,
      usage: usage(result.usage),
      params,
      via: route.via,
      serverMs: performance.now() - t0,
    });
  } catch (e) {
    if (req.signal.aborted) return CANCELLED();
    const err = callError(e);
    if (isAuthError(err)) return Response.json({ error: keyRejected(route) }, { status: 401 });
    const status = err.statusCode ?? err.status ?? 502;
    const message = status === 429 ? rateLimited(route) : (err.message ?? "Model call failed");
    return Response.json({ error: message, name: err.name }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
