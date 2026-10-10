import { describe, expect, it } from "vitest";
import { anthropicModelId, canRun, canThinkWith, cleanKey, detectKey, keyMismatch, pickRoute, runErrorText } from "./keys";
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

describe("run errors", () => {
  it("lets a key problem speak for itself", () => {
    expect(runErrorText("Anthropic rejected your Anthropic key — check it in “Brains & sounds”.")).toBe("Anthropic rejected your Anthropic key — check it in “Brains & sounds”.");
    expect(runErrorText("GPT-5.4 mini needs an AI Gateway key. With only an Anthropic key, pick a Claude model in “Brains & sounds”.")).not.toMatch(/lost the thread/);
  });

  it("says the band lost the thread for anything else", () => {
    expect(runErrorText("Rate limited by Anthropic — try again in a moment.")).toBe("The band lost the thread: Rate limited by Anthropic — try again in a moment.");
    expect(runErrorText("monkeys on the keyboard")).toMatch(/^The band lost the thread/);
  });
});

// Obviously fake keys, shaped like the real thing.
const FAKE_ANTHROPIC = "sk-ant-api03-FAKE-test-key-not-real-0000000000000000";
const FAKE_GATEWAY = "vck_FAKE_test_key_not_real_0000000000000000";

describe("one field for either key", () => {
  it("tells an Anthropic key from a Vercel AI Gateway key by its prefix", () => {
    expect(detectKey(FAKE_ANTHROPIC)).toEqual({ key: FAKE_ANTHROPIC, provider: "anthropic", ok: true, problem: null });
    expect(detectKey(FAKE_GATEWAY)).toEqual({ key: FAKE_GATEWAY, provider: "gateway", ok: true, problem: null });
  });

  it("cleans up what comes along with a pasted key", () => {
    expect(cleanKey(`  ${FAKE_ANTHROPIC}\n`)).toBe(FAKE_ANTHROPIC);
    expect(cleanKey(`"${FAKE_GATEWAY}"`)).toBe(FAKE_GATEWAY);
    expect(cleanKey(`ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}`)).toBe(FAKE_ANTHROPIC);
    expect(cleanKey(`export AI_GATEWAY_API_KEY='${FAKE_GATEWAY}'`)).toBe(FAKE_GATEWAY);
    expect(cleanKey(`Bearer ${FAKE_GATEWAY}`)).toBe(FAKE_GATEWAY);
    expect(detectKey(`AI_GATEWAY_API_KEY="${FAKE_GATEWAY}"`)).toMatchObject({ key: FAKE_GATEWAY, provider: "gateway", ok: true });
  });

  it("stays quiet while the field is empty or a prefix is still being typed", () => {
    for (const partial of ["", "  ", "s", "sk-", "sk-an", "v", "vck"]) expect(detectKey(partial)).toMatchObject({ provider: null, ok: false, problem: null });
  });

  it("names the provider as soon as the prefix is there, even before the key is whole", () => {
    expect(detectKey("sk-ant-api03-abc")).toMatchObject({ provider: "anthropic", ok: false, problem: expect.stringMatching(/cut short/) });
    expect(detectKey("vck_abc")).toMatchObject({ provider: "gateway", ok: false, problem: expect.stringMatching(/cut short/) });
  });

  it("explains keys it can't use", () => {
    expect(detectKey("sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE").problem).toMatch(/OpenAI/);
    expect(detectKey("hello there").problem).toMatch(/sk-ant-.*vck_/);
    expect(detectKey("sk-ant-admin01-FAKE-test-key-not-real-00000000")).toMatchObject({ provider: "anthropic", ok: false, problem: expect.stringMatching(/admin key/) });
    expect(detectKey("sk-ant-api03-FAKE test key not real 0000000000")).toMatchObject({ provider: "anthropic", ok: false, problem: expect.stringMatching(/space/) });
    expect(detectKey("vck_FAKE+test/key=not.real.0000000000000")).toMatchObject({ provider: "gateway", ok: false, problem: expect.stringMatching(/characters/) });
  });
});
