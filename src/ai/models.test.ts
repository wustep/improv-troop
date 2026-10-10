import { describe, expect, it } from "vitest";
import { callCost, callParams, DEFAULT_DIRECTOR_MODEL, DEFAULT_PLAYER_MODEL, fmtCost, modelInfo, MODELS } from "./models";

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

  it("runs Haiku's schema calls without thinking, which breaks its structured output", () => {
    expect(callParams("anthropic/claude-haiku-4.5", { temperature: 0.9, reasoning: "low", schema: true })).toEqual({ temperature: 0.9, reasoning: "none" });
    expect(callParams("anthropic/claude-haiku-4.5", { reasoning: "low" })).toEqual({ reasoning: "low" });
    expect(callParams("anthropic/claude-sonnet-5.5", { reasoning: "low", schema: true })).toEqual({ reasoning: "low" });
  });

  it("sends nothing risky for unknown models", () => {
    expect(callParams("someone/new-model", { temperature: 0.7, reasoning: "low" })).toEqual({});
  });
});

describe("what a take costs", () => {
  it("prices every model, output dearer than input", () => {
    for (const m of MODELS) {
      expect(m.price[0], m.id).toBeGreaterThan(0);
      expect(m.price[1], m.id).toBeGreaterThan(m.price[0]);
    }
  });

  it("adds up a call at list price, and admits when it can't", () => {
    // a 16-bar Haiku jam measured on Anthropic: 39,491 tokens over 16 calls
    expect(callCost("anthropic/claude-haiku-4.5", { inputTokens: 36_513, outputTokens: 2_978 })).toBeCloseTo(0.0514, 4);
    expect(callCost("anthropic/claude-haiku-4.5", undefined)).toBeNull();
    expect(callCost("someone/unknown-model", { inputTokens: 100, outputTokens: 10 })).toBeNull();
  });

  it("reads as a rough figure", () => {
    expect(fmtCost(0.004)).toBe("<$0.01");
    expect(fmtCost(0.0514)).toBe("$0.05");
    expect(fmtCost(1.2)).toBe("$1.20");
  });
});
