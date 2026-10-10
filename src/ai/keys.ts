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
