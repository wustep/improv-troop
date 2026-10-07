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
}

export const MODELS: ModelInfo[] = [
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", temperature: false, efforts: ["low", "medium", "high", "xhigh", "max"], canDisableReasoning: false },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", temperature: true, efforts: [], canDisableReasoning: true, noThinkingWithSchema: true },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", temperature: false, efforts: ["low", "medium", "high", "xhigh", "max"], canDisableReasoning: false },
  { id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1", temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", temperature: false, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", temperature: false, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-fable-5", label: "Claude Fable 5", temperature: false, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8", temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", temperature: true, efforts: ["none", "low", "medium", "high", "max"], canDisableReasoning: true },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", temperature: true, efforts: ["low", "medium", "high", "xhigh", "max"], canDisableReasoning: false },
  { id: "openai/gpt-6-sol", label: "GPT-6 Sol", temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra", temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna", temperature: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], canDisableReasoning: true },
  { id: "openai/gpt-5.5", label: "GPT-5.5", temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh"], canDisableReasoning: true },
  { id: "openai/gpt-5.4", label: "GPT-5.4", temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh"], canDisableReasoning: true },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini", temperature: true, efforts: ["none", "minimal", "low", "medium", "high", "xhigh"], canDisableReasoning: true },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", temperature: true, efforts: ["low", "high"], canDisableReasoning: false },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", temperature: true, efforts: ["low", "high"], canDisableReasoning: false },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", temperature: true, efforts: ["none", "low", "medium", "high"], canDisableReasoning: true },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", temperature: true, efforts: ["none", "low", "medium", "high"], canDisableReasoning: true },
];

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
