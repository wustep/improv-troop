import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Obviously fake keys, shaped like the real thing. No real provider is ever called: fetch is faked.
const FAKE_ANTHROPIC = "sk-ant-api03-FAKE-test-key-not-real-0000000000000000";
const FAKE_GATEWAY = "vck_FAKE_test_key_not_real_0000000000000000";

const check = (key: unknown) => POST(new Request("http://x/api/key", { method: "POST", body: JSON.stringify({ key }) }));

/** Stands in for the providers: records each request and answers with `reply`. */
function fakeProviders(reply: (url: string) => Response | Promise<Response>) {
  const seen: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push({ url, headers: new Headers(init?.headers) });
      return reply(url);
    }),
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("key check route", () => {
  it("asks Anthropic for its model list with an Anthropic key", async () => {
    const seen = fakeProviders(() => Response.json({ data: [], has_more: false }));
    const res = await check(FAKE_ANTHROPIC);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: "anthropic" });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(seen[0].headers.get("x-api-key")).toBe(FAKE_ANTHROPIC);
  });

  it("asks the gateway for its credit balance with a gateway key", async () => {
    const seen = fakeProviders(() => Response.json({ balance: "5.00", total_used: "0.00" }));
    const res = await check(FAKE_GATEWAY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: "gateway" });
    expect(seen[0].url).toMatch(/^https:\/\/ai-gateway\.vercel\.sh\/v1\/credits/);
    expect(seen[0].headers.get("authorization")).toBe(`Bearer ${FAKE_GATEWAY}`);
  });

  it("cleans up a pasted env line before checking", async () => {
    fakeProviders(() => Response.json({ data: [] }));
    expect(await (await check(`ANTHROPIC_API_KEY="${FAKE_ANTHROPIC}"`)).json()).toEqual({ ok: true, provider: "anthropic" });
  });

  it("says when the provider turns a key down", async () => {
    fakeProviders(() => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }));
    const res = await check(FAKE_ANTHROPIC);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/Anthropic didn’t accept that key/);

    fakeProviders(() => Response.json({ error: { type: "authentication_error", message: "Invalid API key" } }, { status: 401 }));
    const gw = await check(FAKE_GATEWAY);
    expect(gw.status).toBe(401);
    expect((await gw.json()).error).toMatch(/Vercel AI Gateway didn’t accept that key/);
  });

  it("can't tell when the provider is down or unreachable", async () => {
    fakeProviders(() => new Response("overloaded", { status: 529 }));
    expect((await check(FAKE_ANTHROPIC)).status).toBe(502);
    fakeProviders(() => Promise.reject(new TypeError("fetch failed")));
    expect((await check(FAKE_ANTHROPIC)).status).toBe(502);
  });

  it("turns away anything not shaped like a key, without calling anyone", async () => {
    const seen = fakeProviders(() => Response.json({}));
    for (const key of ["", "hello", "sk-ant-short", "sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE", 42]) expect((await check(key)).status).toBe(400);
    expect((await POST(new Request("http://x/api/key", { method: "POST", body: "{nope" }))).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("never logs the key", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    fakeProviders(() => Response.json({ error: "nope" }, { status: 401 }));
    await check(FAKE_ANTHROPIC);
    await check(FAKE_GATEWAY);
    const said = JSON.stringify(logs.flatMap((l) => l.mock.calls));
    expect(said).not.toContain("FAKE_test_key");
    expect(said).not.toContain("FAKE-test-key");
  });
});
