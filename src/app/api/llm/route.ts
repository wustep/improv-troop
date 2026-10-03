import { createGateway, generateText } from "ai";

// Thin proxy to the Vercel AI Gateway. The browser orchestrates the band (so the
// debug panel sees every step); each call here is one short model request.
//
// Keys: the user's own gateway key from the request. A server-side key is only
// used when IMPROV_TROOP_SERVER_KEY is set explicitly — we never fall back to
// ambient Vercel OIDC credentials, so a public deployment can't spend the owner's credits.

export const maxDuration = 120;

const MODEL_RE = /^[a-z0-9-]+\/[a-z0-9.\-]+$/i;

interface Body {
  key?: string;
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "none" | "minimal" | "low" | "medium" | "provider-default";
}

export async function POST(req: Request) {
  const t0 = performance.now();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON body" }, { status: 400 });
  }
  const apiKey = body.key?.trim() || process.env.IMPROV_TROOP_SERVER_KEY;
  if (!apiKey) return Response.json({ error: "Add your Vercel AI Gateway key to let the band think." }, { status: 401 });
  if (!MODEL_RE.test(body.model ?? "")) return Response.json({ error: `Unknown model "${body.model}"` }, { status: 400 });
  if (!body.prompt || body.prompt.length > 60_000 || (body.system?.length ?? 0) > 30_000) {
    return Response.json({ error: "Prompt missing or too long" }, { status: 400 });
  }

  const gateway = createGateway({ apiKey });
  try {
    const result = await generateText({
      model: gateway(body.model),
      system: body.system,
      prompt: body.prompt,
      temperature: body.temperature,
      maxOutputTokens: Math.min(body.maxOutputTokens ?? 2000, 8000),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(110_000),
      ...(body.reasoning ? { reasoning: body.reasoning } : {}),
    });
    return Response.json({
      text: result.text,
      finishReason: result.finishReason,
      usage: {
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
      },
      serverMs: performance.now() - t0,
    });
  } catch (e) {
    const err = e as { message?: string; statusCode?: number; status?: number; name?: string };
    const status = err.statusCode ?? err.status ?? 502;
    let message = err.message ?? "Model call failed";
    if (status === 401 || status === 403) message = "The AI Gateway rejected that key.";
    if (status === 429) message = "Rate limited by the AI Gateway — try again in a moment.";
    return Response.json({ error: message, name: err.name }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
