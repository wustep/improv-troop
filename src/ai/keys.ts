// Which key, and which provider, a model call goes through. Shared by the route (which picks)
// and the browser (which greys out models no key can reach).
//
// Precedence, first match wins:
//   1. the visitor's AI Gateway key (from the browser): every model, through the gateway
//   2. the visitor's Anthropic key (from the browser): Claude models, straight to Anthropic
//   3. the server's gateway key (IMPROV_TROOP_SERVER_KEY): every model, through the gateway
//   4. the server's Anthropic key (ANTHROPIC_API_KEY): Claude models, straight to Anthropic
// A visitor's own key always beats one the server lends, and the gateway beats a direct key
// at the same level. Other providers' models need a gateway key; with only Anthropic keys
// they're unavailable.

export interface KeySet {
  gateway?: string;
  anthropic?: string;
}

export interface Route {
  via: "gateway" | "anthropic";
  from: "browser" | "server";
  apiKey: string;
}

/** Which providers some key can reach, without the keys themselves (what the browser knows). */
export interface KeyAccess {
  gateway: boolean;
  anthropic: boolean;
}

export const isClaude = (model: string) => model.startsWith("anthropic/");

/** Gateway ids name Claude models with dots ("anthropic/claude-sonnet-5.5"); Anthropic's API uses dashes ("claude-sonnet-5-5"). */
export function anthropicModelId(model: string) {
  return model.replace(/^anthropic\//, "").replaceAll(".", "-");
}

export function pickRoute(model: string, browser: KeySet, server: KeySet): Route | null {
  const claude = isClaude(model);
  const b = { gateway: browser.gateway?.trim(), anthropic: browser.anthropic?.trim() };
  const s = { gateway: server.gateway?.trim(), anthropic: server.anthropic?.trim() };
  if (b.gateway) return { via: "gateway", from: "browser", apiKey: b.gateway };
  if (claude && b.anthropic) return { via: "anthropic", from: "browser", apiKey: b.anthropic };
  if (s.gateway) return { via: "gateway", from: "server", apiKey: s.gateway };
  if (claude && s.anthropic) return { via: "anthropic", from: "server", apiKey: s.anthropic };
  return null;
}

export const canThinkWith = (a: KeyAccess) => a.gateway || a.anthropic;

/** Some key can reach this model. */
export const canRun = (model: string, a: KeyAccess) => a.gateway || (a.anthropic && isClaude(model));

export type KeyProvider = keyof KeySet;

export const KEY_PROVIDER_LABEL: Record<KeyProvider, string> = { gateway: "Vercel AI Gateway", anthropic: "Anthropic" };

const KEY_PREFIX: Record<KeyProvider, string> = { gateway: "vck_", anthropic: "sk-ant-" };

/** Shorter than this after its prefix, a key was cut off on the way over (real ones are far longer). */
const MIN_KEY_BODY = 20;

/**
 * What someone pasted, minus what came along with it: surrounding quotes, a `Bearer ` prefix, or a
 * whole line from an env file (`ANTHROPIC_API_KEY="sk-ant-…"`, with or without `export`).
 */
export function cleanKey(raw: string) {
  let k = raw.trim();
  k = k.replace(/^export\s+/, "").replace(/^[A-Z][A-Z0-9_]*\s*[=:]\s*/, "");
  k = k.replace(/^bearer\s+/i, "");
  k = k.replace(/^(["'`])(.*)\1$/, "$2").trim();
  return k;
}

export interface KeyGuess {
  /** The cleaned-up key, as it would be saved. */
  key: string;
  /** Whose key it looks like, from its prefix (null when nobody's yet). */
  provider: KeyProvider | null;
  /** Well-formed enough to save. */
  ok: boolean;
  /** Why it can't be saved yet; null while the field is empty or still being typed. */
  problem: string | null;
}

/**
 * One field for either key: the prefix says whose it is. Anthropic API keys start `sk-ant-`
 * (`sk-ant-api03-…`); Vercel AI Gateway keys start `vck_`. Both are then URL-safe base64.
 * This only checks the shape; whether the provider takes it is the server's check (/api/key).
 */
export function detectKey(raw: string): KeyGuess {
  const key = cleanKey(raw);
  const none = (problem: string | null, provider: KeyProvider | null = null): KeyGuess => ({ key, provider, ok: false, problem });
  if (!key) return none(null);
  const provider = (Object.keys(KEY_PREFIX) as KeyProvider[]).find((p) => key.startsWith(KEY_PREFIX[p])) ?? null;
  if (!provider) {
    // still typing one of the prefixes: nothing to complain about yet
    if (Object.values(KEY_PREFIX).some((p) => p.startsWith(key))) return none(null);
    if (key.startsWith("sk-")) return none("That looks like an OpenAI key. Jamming takes an Anthropic key (sk-ant-…) or a Vercel AI Gateway key (vck_…).");
    return none("Not a key Jamming knows. Anthropic keys start with sk-ant-, Vercel AI Gateway keys with vck_.");
  }
  const body = key.slice(KEY_PREFIX[provider].length);
  if (/\s/.test(key)) return none("There’s a space in the middle. Paste just the key, in one piece.", provider);
  if (!/^[A-Za-z0-9_-]*$/.test(body)) return none("That has characters a key never has. Copy it again from the provider.", provider);
  if (provider === "anthropic" && body.startsWith("admin")) return none("That’s an Anthropic admin key, which can’t call models. Use a regular API key (sk-ant-api…).", provider);
  if (body.length < MIN_KEY_BODY) return none(`That looks cut short. Copy the whole ${KEY_PROVIDER_LABEL[provider]} key.`, provider);
  return { key, provider, ok: true, problem: null };
}

/** A gentle warning when a pasted key looks like it belongs in the other field. */
export function keyMismatch(field: keyof KeySet, key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (field === "gateway" && k.startsWith("sk-ant-")) return "That looks like an Anthropic key; it goes in the Anthropic field below.";
  if (field === "anthropic" && !k.startsWith("sk-ant-")) return "Anthropic keys start with sk-ant-. Double-check you copied the whole key.";
  return null;
}

/** A run stopped because of a key (missing, rejected, or one that can't reach the model): the fix is in "Brains & sounds". */
export const isKeyProblem = (error: string) => /\bkey\b/i.test(error);

/** How a failed run reads. A key problem already says what to do; anything else, the band lost the thread mid-take. */
export const runErrorText = (error: string) => (isKeyProblem(error) ? error : `The band lost the thread: ${error}`);
