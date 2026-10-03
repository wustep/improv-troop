/** Pull the first JSON object out of a model reply (fenced or bare), tolerating common slop. */
export function extractJson(text: string): { value: unknown; error?: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  if (start < 0) return { value: null, error: "no JSON object in reply" };
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  let body = end > 0 ? src.slice(start, end + 1) : src.slice(start);
  const attempts: string[] = [body];
  // trailing commas
  attempts.push(body.replace(/,\s*([}\]])/g, "$1"));
  // truncated reply: close open brackets
  if (end < 0) {
    body = body.replace(/,\s*$/, "");
    const opens: string[] = [];
    let s = false;
    let e2 = false;
    for (const ch of body) {
      if (s) {
        if (e2) e2 = false;
        else if (ch === "\\") e2 = true;
        else if (ch === '"') s = false;
        continue;
      }
      if (ch === '"') s = true;
      else if (ch === "{" || ch === "[") opens.push(ch);
      else if (ch === "}" || ch === "]") opens.pop();
    }
    let closed = body + (s ? '"' : "");
    closed = closed.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
    for (let i = opens.length - 1; i >= 0; i--) closed += opens[i] === "{" ? "}" : "]";
    attempts.push(closed, closed.replace(/,\s*([}\]])/g, "$1"));
  }
  let lastErr = "";
  for (const a of attempts) {
    try {
      return { value: JSON.parse(a), error: a === attempts[0] ? undefined : "repaired malformed JSON" };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { value: null, error: `unparseable JSON: ${lastErr}` };
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function asString(v: unknown, max = 400): string | undefined {
  if (typeof v === "string") return v.slice(0, max);
  if (typeof v === "number") return String(v);
  return undefined;
}

/** "5-8" → [5,6,7,8]; 5 → [5]; "5" → [5]. 1-based in, 1-based out. */
export function parseBarRange(v: unknown): number[] {
  if (typeof v === "number" && Number.isFinite(v)) return [Math.round(v)];
  if (typeof v !== "string") return [];
  const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(v);
  if (!m) return [];
  const a = parseInt(m[1], 10);
  const b = m[2] ? parseInt(m[2], 10) : a;
  const out: number[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 64; i++) out.push(i);
  return out;
}
