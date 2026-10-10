import { createGateway } from "ai";
import { detectKey, KEY_PROVIDER_LABEL, type KeyProvider } from "@/ai/keys";

// Checks a visitor's key before the browser saves it: one free, authenticated read from the
// provider (Anthropic's model list, the gateway's credit balance), no tokens spent. The key is
// used for this request only and never logged or stored; the browser keeps it.
//
//   200 { ok: true, provider }            the provider took it
//   400 { ok: false, error }              not shaped like a key we know
//   401 { ok: false, provider, error }    the provider turned it down
//   502 { ok: false, provider, error }    couldn't ask (network, outage): the browser saves it anyway

const TIMEOUT_MS = 8000;

type Check = "ok" | "rejected" | "unreachable";

const authStatus = (status: number) => status === 401 || status === 403;

async function checkAnthropic(key: string, signal: AbortSignal): Promise<Check> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    signal,
  });
  return res.ok ? "ok" : authStatus(res.status) ? "rejected" : "unreachable";
}

async function checkGateway(key: string): Promise<Check> {
  try {
    await createGateway({ apiKey: key }).getCredits();
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    return authStatus(status) || (e as { name?: string }).name === "GatewayAuthenticationError" ? "rejected" : "unreachable";
  }
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = ((await req.json()) as { key?: unknown }).key;
  } catch {
    return Response.json({ ok: false, error: "Bad JSON body" }, { status: 400 });
  }
  const guess = detectKey(typeof raw === "string" ? raw : "");
  if (!guess.ok || !guess.provider) return Response.json({ ok: false, error: guess.problem ?? "Paste a key to check." }, { status: 400 });
  const provider: KeyProvider = guess.provider;

  let check: Check;
  try {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    check =
      provider === "anthropic"
        ? await checkAnthropic(guess.key, signal)
        : await Promise.race([checkGateway(guess.key), new Promise<Check>((r) => signal.addEventListener("abort", () => r("unreachable"), { once: true }))]);
  } catch {
    check = "unreachable";
  }

  const name = KEY_PROVIDER_LABEL[provider];
  if (check === "ok") return Response.json({ ok: true, provider });
  if (check === "rejected") return Response.json({ ok: false, provider, error: `${name} didn’t accept that key. Check it’s still active, or paste a fresh one.` }, { status: 401 });
  return Response.json({ ok: false, provider, error: `Couldn’t reach ${name} to check the key.` }, { status: 502 });
}
