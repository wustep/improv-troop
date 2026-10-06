import { describe, expect, it } from "vitest";
import { POST } from "./route";

const body = JSON.stringify({ key: "mock:2000", model: "anthropic/claude-sonnet-5-5", system: "", prompt: "count it off" });

describe("llm route", () => {
  it("answers a mock call", async () => {
    const res = await POST(new Request("http://x/api/llm", { method: "POST", body: JSON.stringify({ ...JSON.parse(body), key: "mock:1" }) }));
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
});
