import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const body = JSON.stringify({ key: "mock:2000", model: "anthropic/claude-sonnet-5-5", system: "", prompt: "count it off" });

const post = (b: Record<string, unknown>) => POST(new Request("http://x/api/llm", { method: "POST", body: JSON.stringify({ system: "", prompt: "count it off", ...b }) }));

beforeEach(() => {
  // never the developer's own keys from .env.local
  vi.stubEnv("IMPROV_TROOP_SERVER_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stands in for api.anthropic.com: records each request and answers with `reply`. */
function fakeAnthropic(reply: (req: { url: string; headers: Headers; body: Record<string, unknown> }) => Response) {
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const req = { url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) };
      seen.push(req);
      return reply(req);
    }),
  );
  return seen;
}

const message = (text: string) =>
  Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 3 },
  });

describe("llm route", () => {
  it("answers a mock call", async () => {
    const res = await POST(new Request("http://x/api/llm", { method: "POST", body: JSON.stringify({ ...JSON.parse(body), key: "mock:1" }) }));
    expect(res.status).toBe(200);
  });

  it("answers a mock call from the Anthropic field too", async () => {
    const res = await post({ anthropicKey: "mock:1", model: "anthropic/claude-haiku-4.5" });
    expect(res.status).toBe(200);
  });

  it("stops work when the client goes away", async () => {
    const ctl = new AbortController();
    const t0 = performance.now();
    const pending = POST(new Request("http://x/api/llm", { method: "POST", body, signal: ctl.signal }));
    setTimeout(() => ctl.abort(), 20);
    const res = await pending;
    expect(res.status).toBe(499);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("asks for a key when there's none anywhere", async () => {
    const res = await post({ model: "anthropic/claude-sonnet-5.5" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/AI Gateway or Anthropic key/);
  });

  it("explains that other providers need the gateway when only an Anthropic key is set", async () => {
    const res = await post({ model: "openai/gpt-6-sol", anthropicKey: "sk-ant-test" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/needs an AI Gateway key.*Claude model/);
  });

  it("calls Anthropic directly with the visitor's key, under Anthropic's model id", async () => {
    const seen = fakeAnthropic(() => message("one, two, one two three four"));
    const res = await post({ model: "anthropic/claude-sonnet-5.5", anthropicKey: "sk-ant-test-browser" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ text: "one, two, one two three four", via: "anthropic", structured: false });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(seen[0].headers.get("x-api-key")).toBe("sk-ant-test-browser");
    expect(seen[0].body.model).toBe("claude-sonnet-5-5");
  });

  it("uses the server's ANTHROPIC_API_KEY for Claude when nothing comes from the browser", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-server");
    const seen = fakeAnthropic(() => message("ok"));
    const res = await post({ model: "anthropic/claude-haiku-4.5" });
    expect(res.status).toBe(200);
    expect(seen[0].headers.get("x-api-key")).toBe("sk-ant-test-server");
    expect(seen[0].body.model).toBe("claude-haiku-4-5");
  });

  it("says when Anthropic rejects the key, without echoing or logging it", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    fakeAnthropic(() => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }));
    const res = await post({ model: "anthropic/claude-sonnet-5.5", anthropicKey: "sk-ant-test-wrong" });
    const text = await res.text();
    expect(res.status).toBe(401);
    expect(JSON.parse(text).error).toBe("Anthropic rejected your Anthropic key — check it in “Brains & sounds”.");
    expect(text).not.toContain("sk-ant-test-wrong");
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain("sk-ant-test-wrong");
  });

  it("blames the server's key, not the visitor, when that one is rejected", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-server");
    fakeAnthropic(() => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }));
    const res = await post({ model: "anthropic/claude-sonnet-5.5" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/this server's Anthropic key.*add your own/);
  });

  it("names Anthropic when it rate-limits", async () => {
    fakeAnthropic(() => Response.json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { status: 429 }));
    const res = await post({ model: "anthropic/claude-sonnet-5.5", anthropicKey: "sk-ant-test" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Rate limited by Anthropic/);
  });

  it("goes through the gateway, not Anthropic, when the visitor has a gateway key", async () => {
    const seen = fakeAnthropic(() => Response.json({ error: { message: "stub", type: "authentication_error" } }, { status: 401 }));
    await post({ model: "anthropic/claude-sonnet-5.5", key: "vck_test", anthropicKey: "sk-ant-test" });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => !r.url.includes("api.anthropic.com"))).toBe(true);
  });

  it("reports which keys the server lends, never the keys", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-server");
    const res = await GET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ serverKey: false, serverAnthropicKey: true });
    expect(text).not.toContain("sk-ant");
  });
});
