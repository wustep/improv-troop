// Language models offered in the pickers. Verified against the Vercel AI Gateway catalog
// (https://ai-gateway.vercel.sh/v1/models) on 2026-10-03: every entry is a language model
// tagged for structured output. Capabilities come from the same catalog so each call only
// sends parameters the model accepts (e.g. Claude Sonnet 5.5 takes no temperature).

export type ReasoningLevel = "none" | "minimal" | "low" | "medium" | "high";

export interface ModelInfo {
  id: string;
  label: string;
  /** Accepts a temperature parameter. */
  temperature: boolean;
  /** Reasoning effort values the model accepts (empty = on/off toggle only). */
  efforts: string[];
  /** Reasoning can be switched off entirely. */
  canDisableReasoning: boolean;
  /**
   * Thinking and a JSON schema don't mix: measured on the gateway, Haiku 4.5's count-off with
   * thinking on returned no structured output 6 times in 8 (3,500 tokens each, then a retry as
   * text); with thinking off, 8 in 8 at 350 tokens. Schema calls run without thinking.
   */
  noThinkingWithSchema?: boolean;
  /** List price in dollars per million tokens, [input, output], from the gateway catalog on 2026-10-10. For an estimate only. */
  price: [number, number];
}

export const MODELS: ModelInfo[] = [
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", price: [2, 10], temperature: false, efforts: ["low", "medium", "high", "xhigh", "max"], canDisableReasoning: false },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", price: [1, 5], temperature: true, efforts: [], canDisableReasoning: true, noThinkingWithSchema: true },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", price: [4, 20], temperature: false, efforts: ["low", "medium", "high", "xhigh", "max"], canDisableReasoning: false },
  { id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1", price: [10, 50], temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", price: [5, 25], temperature: false, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", price: [2, 10], temperature: false, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-fable-5", label: "Claude Fable 5", price: [10, 50], temperature: false, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8", price: [5, 25], temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", price: [3, 15], temperature: true, efforts: ["none", "low", "medium", "high", "max"], canDisableReasoning: true },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", price: [2, 10], temperature: true, efforts: ["low", "medium", "high", "xhigh", "max"], canDisableReasoning: false },
  { id: "openai/gpt-6-sol", label: "GPT-6 Sol", price: [2, 10], temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", price: [0.1, 0.5], temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", price: [4, 20], temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra", price: [2, 12], temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna", price: [0.2, 1.2], temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.5", label: "GPT-5.5", price: [5, 30], temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh"], canDisableReasoning: true },
  { id: "openai/gpt-5.4", label: "GPT-5.4", price: [2.5, 15], temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh"], canDisableReasoning: true },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini", price: [0.75, 4.5], temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh"], canDisableReasoning: true },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", price: [0.75, 3.75], temperature: true, efforts: ["low", "high"], canDisableReasoning: false },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", price: [2, 12], temperature: true, efforts: ["low", "high"], canDisableReasoning: false },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", price: [1.25, 10], temperature: true, efforts: ["none", "low", "medium", "high"], canDisableReasoning: true },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", price: [0.3, 2.5], temperature: true, efforts: ["none", "low", "medium", "high"], canDisableReasoning: true },
];

/** Roughly what a call cost at list price, in dollars; null when the model or its usage is unknown. */
export function callCost(model: string, usage: { inputTokens?: number | null; outputTokens?: number | null } | undefined): number | null {
  const price = modelInfo(model)?.price;
  if (!price || !usage || (usage.inputTokens == null && usage.outputTokens == null)) return null;
  return ((usage.inputTokens ?? 0) * price[0] + (usage.outputTokens ?? 0) * price[1]) / 1e6;
}

/** A take's estimated spend, for people paying with their own key: "<$0.01", "$0.06", "$1.20". */
export const fmtCost = (usd: number) => (usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);

export const DEFAULT_DIRECTOR_MODEL = "anthropic/claude-sonnet-5.5";
export const DEFAULT_PLAYER_MODEL = "anthropic/claude-haiku-4.5";

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function modelInfo(id: string): ModelInfo | undefined {
  return BY_ID.get(id);
}

export const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };

export function modelsByProvider(): { provider: string; models: ModelInfo[] }[] {
  const groups = new Map<string, ModelInfo[]>();
  for (const m of MODELS) {
    const p = m.id.split("/")[0];
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(m);
  }
  return [...groups.entries()].map(([provider, models]) => ({ provider, models }));
}

const ORDER: ReasoningLevel[] = ["none", "minimal", "low", "medium", "high"];

/**
 * Translate what a pipeline step wants (some temperature, a reasoning level) into what this
 * model accepts. Unknown models get neither, so the provider defaults apply.
 */
export function callParams(
  id: string,
  want: { temperature?: number; reasoning?: ReasoningLevel; schema?: boolean },
): { temperature?: number; reasoning?: ReasoningLevel } {
  const m = BY_ID.get(id);
  if (!m) return {};
  if (want.schema && m.noThinkingWithSchema && want.reasoning) want = { ...want, reasoning: "none" };
  const out: { temperature?: number; reasoning?: ReasoningLevel } = {};
  if (want.reasoning) {
    if (want.reasoning === "none" && m.canDisableReasoning) out.reasoning = "none";
    else if (m.efforts.length) {
      // the lowest supported level at or above the request
      const start = ORDER.indexOf(want.reasoning);
      const hit = ORDER.slice(Math.max(1, start)).find((l) => m.efforts.includes(l));
      out.reasoning = hit ?? (m.efforts.find((e) => e !== "none") as ReasoningLevel | undefined);
    } else if (want.reasoning !== "none") out.reasoning = want.reasoning; // toggle-style: SDK maps to a budget
    else out.reasoning = "none";
  }
  // Anthropic models reject a custom temperature while thinking.
  const thinking = out.reasoning !== undefined && out.reasoning !== "none";
  if (m.temperature && want.temperature !== undefined && !(thinking && id.startsWith("anthropic/"))) {
    out.temperature = want.temperature;
  }
  return out;
}
