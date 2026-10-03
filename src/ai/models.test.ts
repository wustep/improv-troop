import { describe, expect, it } from "vitest";
import { callParams, DEFAULT_DIRECTOR_MODEL, DEFAULT_PLAYER_MODEL, modelInfo, MODELS } from "./models";

describe("model catalog", () => {
  it("keeps the defaults and has no duplicates", () => {
    expect(DEFAULT_DIRECTOR_MODEL).toBe("anthropic/claude-sonnet-5.5");
    expect(DEFAULT_PLAYER_MODEL).toBe("anthropic/claude-haiku-4.5");
    expect(modelInfo(DEFAULT_DIRECTOR_MODEL)).toBeTruthy();
    expect(modelInfo(DEFAULT_PLAYER_MODEL)).toBeTruthy();
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
    expect(MODELS.some((m) => /-fast$|codex|realtime|embed/.test(m.id))).toBe(false);
  });

  it("never sends a temperature to models that reject it", () => {
    expect(callParams("anthropic/claude-sonnet-5.5", { temperature: 0.8, reasoning: "low" })).toEqual({ reasoning: "low" });
    // can't switch reasoning off on Sonnet 5.5: use its lowest effort
    expect(callParams("anthropic/claude-sonnet-5.5", { temperature: 0.8, reasoning: "none" })).toEqual({ reasoning: "low" });
  });

  it("keeps temperature when reasoning is off and the model allows it", () => {
    expect(callParams("anthropic/claude-haiku-4.5", { temperature: 0.9, reasoning: "none" })).toEqual({ temperature: 0.9, reasoning: "none" });
    expect(callParams("openai/gpt-5.4-mini", { temperature: 0.9, reasoning: "low" })).toEqual({ temperature: 0.9, reasoning: "low" });
  });

  it("maps to the nearest supported effort", () => {
    expect(callParams("google/gemini-3.8-flash", { reasoning: "none" })).toEqual({ reasoning: "low" });
    expect(callParams("google/gemini-3.8-flash", { reasoning: "medium" })).toEqual({ reasoning: "high" });
    expect(callParams("openai/gpt-6.1-sol", { reasoning: "minimal", temperature: 0.5 })).toEqual({ reasoning: "low", temperature: 0.5 });
  });

  it("sends nothing risky for unknown models", () => {
    expect(callParams("someone/new-model", { temperature: 0.7, reasoning: "low" })).toEqual({});
  });
});
