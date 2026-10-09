import { describe, expect, it } from "vitest";
import { anthropicModelId, canRun, canThinkWith, keyMismatch, pickRoute } from "./keys";
import { MODELS } from "./models";

const CLAUDE = "anthropic/claude-sonnet-5.5";
const GPT = "openai/gpt-6-sol";

describe("key routing", () => {
  it("prefers the visitor's gateway key for every model", () => {
    const browser = { gateway: "vck_mine", anthropic: "sk-ant-mine" };
    const server = { gateway: "vck_server", anthropic: "sk-ant-server" };
    expect(pickRoute(CLAUDE, browser, server)).toEqual({ via: "gateway", from: "browser", apiKey: "vck_mine" });
    expect(pickRoute(GPT, browser, server)).toEqual({ via: "gateway", from: "browser", apiKey: "vck_mine" });
  });

  it("sends Claude straight to Anthropic with the visitor's Anthropic key, ahead of any server key", () => {
    const server = { gateway: "vck_server", anthropic: "sk-ant-server" };
    expect(pickRoute(CLAUDE, { anthropic: "sk-ant-mine" }, server)).toEqual({ via: "anthropic", from: "browser", apiKey: "sk-ant-mine" });
    // other providers fall through to the server's gateway
    expect(pickRoute(GPT, { anthropic: "sk-ant-mine" }, server)).toEqual({ via: "gateway", from: "server", apiKey: "vck_server" });
  });

  it("uses the visitor's Anthropic key with no server keys at all", () => {
    expect(pickRoute(CLAUDE, { anthropic: "sk-ant-mine" }, {})).toEqual({ via: "anthropic", from: "browser", apiKey: "sk-ant-mine" });
  });

  it("falls back to the server's gateway key, then its Anthropic key for Claude", () => {
    expect(pickRoute(CLAUDE, {}, { gateway: "vck_server", anthropic: "sk-ant-server" })).toEqual({ via: "gateway", from: "server", apiKey: "vck_server" });
    expect(pickRoute(CLAUDE, {}, { anthropic: "sk-ant-server" })).toEqual({ via: "anthropic", from: "server", apiKey: "sk-ant-server" });
  });

  it("has no route for other providers with only Anthropic keys, or with no keys", () => {
    expect(pickRoute(GPT, { anthropic: "sk-ant-mine" }, { anthropic: "sk-ant-server" })).toBeNull();
    expect(pickRoute(CLAUDE, {}, {})).toBeNull();
    // blank keys count as none
    expect(pickRoute(CLAUDE, { gateway: "  ", anthropic: "" }, { gateway: " " })).toBeNull();
  });

  it("maps every Claude model in the catalog to Anthropic's id", () => {
    expect(anthropicModelId("anthropic/claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(anthropicModelId("anthropic/claude-haiku-4.5")).toBe("claude-haiku-4-5");
    expect(anthropicModelId("anthropic/claude-opus-5")).toBe("claude-opus-5");
    for (const m of MODELS.filter((m) => m.id.startsWith("anthropic/"))) expect(anthropicModelId(m.id)).toMatch(/^claude-[a-z]+-\d+(-\d+)?$/);
  });

  it("knows which models some key can reach", () => {
    expect(canRun(GPT, { gateway: false, anthropic: true })).toBe(false);
    expect(canRun(CLAUDE, { gateway: false, anthropic: true })).toBe(true);
    expect(canRun(GPT, { gateway: true, anthropic: false })).toBe(true);
    expect(canThinkWith({ gateway: false, anthropic: false })).toBe(false);
    expect(canThinkWith({ gateway: false, anthropic: true })).toBe(true);
  });

  it("notices a key pasted into the wrong field", () => {
    expect(keyMismatch("gateway", "sk-ant-api03-abc")).toMatch(/Anthropic key/);
    expect(keyMismatch("anthropic", "vck_abc")).toMatch(/sk-ant-/);
    expect(keyMismatch("anthropic", "sk-ant-api03-abc")).toBeNull();
    expect(keyMismatch("gateway", "vck_abc")).toBeNull();
    expect(keyMismatch("anthropic", "")).toBeNull();
  });
});
