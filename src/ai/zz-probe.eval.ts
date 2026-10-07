import { loadEnvFile } from "node:process";
import { it, vi } from "vitest";
import { POST } from "@/app/api/llm/route";
import { defaultMembers } from "@/music/instruments";
import { defaultSettings } from "@/music/local";
import { useDebug } from "@/state/debug";
import { startImproviser } from "./improviser";
loadEnvFile(".env.local");
it("probe count-off", { timeout: 600000 }, async () => {
  const band = defaultMembers();
  let captured: Record<string, unknown> | null = null;
  const ctl = new AbortController();
  vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body));
    ctl.abort();
    throw new DOMException("Aborted", "AbortError");
  });
  useDebug.getState().startRun("p", "p");
  try { await startImproviser({ ...defaultSettings(band), directorModel: process.env.PMODEL ?? "anthropic/claude-haiku-4.5", soloists: ["bear"] }, band, { runId: "p", apiKey: "", signal: ctl.signal, onStatus() {}, onChat() {}, onScore() {} }).promise; } catch {}
  vi.unstubAllGlobals();
  const variants = (process.env.PROBE ?? "low").split(",");
  for (const v of variants) {
    let ok = 0, fb = 0, out = 0;
    const N = Number(process.env.N ?? 6);
    await Promise.all(Array.from({ length: N }, async () => {
      const body = { ...captured!, key: undefined, reasoning: v };
      const r = await POST(new Request("http://x/api/llm", { method: "POST", body: JSON.stringify(body) }));
      const d = await r.json();
      if (d.structured) ok++; else { fb++; console.log("  fallback:", d.fallbackReason?.slice(0, 160), d.finishReason); }
      out += d.usage?.outputTokens ?? 0;
    }));
    console.log(`reasoning=${v}: structured ${ok}/${N}, fallback ${fb}, avg out ${Math.round(out / N)}`);
  }
});
