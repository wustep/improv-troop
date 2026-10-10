import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Obviously fake keys, shaped like the real thing.
const FAKE_ANTHROPIC = "sk-ant-api03-FAKE-test-key-not-real-0000000000000000";
const FAKE_GATEWAY = "vck_FAKE_test_key_not_real_0000000000000000";

const ls = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k),
  clear: () => ls.clear(),
});

const { canThink, keyAccess, shouldAskForKey, useTroop } = await import("./store");
const initial = useTroop.getState();

beforeEach(() => {
  ls.clear();
  useTroop.setState(initial, true);
});

afterEach(() => vi.restoreAllMocks());

const saved = () => JSON.parse(ls.get("improv-troop:v1") ?? "{}");

describe("who sees the key dialog on arrival", () => {
  const first = { asked: false, returning: false, browserKey: false, serverKey: false, sharedArrival: false };

  it("asks a first-time visitor", () => {
    expect(shouldAskForKey(first)).toBe(true);
  });

  it("doesn't nag anyone with something to go on", () => {
    expect(shouldAskForKey({ ...first, asked: true })).toBe(false);
    expect(shouldAskForKey({ ...first, returning: true })).toBe(false);
    expect(shouldAskForKey({ ...first, browserKey: true })).toBe(false);
    expect(shouldAskForKey({ ...first, serverKey: true })).toBe(false);
    expect(shouldAskForKey({ ...first, sharedArrival: true })).toBe(false);
  });
});

describe("answering the key dialog", () => {
  it("saves an Anthropic key in the Anthropic slot and remembers the answer", () => {
    useTroop.setState({ keyDialog: true });
    useTroop.getState().saveKey("anthropic", FAKE_ANTHROPIC);
    const s = useTroop.getState();
    expect(s).toMatchObject({ anthropicKey: FAKE_ANTHROPIC, apiKey: "", keyDialog: false, heuristic: false });
    expect(saved().anthropicKey).toBe(FAKE_ANTHROPIC);
    expect(ls.get("jamming:key-asked")).toBe("1");
    expect(keyAccess(s)).toEqual({ gateway: false, anthropic: true });
  });

  it("saves a gateway key in the gateway slot, where it goes first", () => {
    useTroop.getState().saveKey("gateway", FAKE_GATEWAY);
    expect(useTroop.getState()).toMatchObject({ apiKey: FAKE_GATEWAY, anthropicKey: "" });
    expect(saved().apiKey).toBe(FAKE_GATEWAY);
    expect(keyAccess(useTroop.getState())).toEqual({ gateway: true, anthropic: false });
  });

  it("skipping picks the heuristic band, even when the server lends a key", () => {
    useTroop.setState({ keyDialog: true, serverKey: true, serverAnthropicKey: true });
    expect(canThink(useTroop.getState())).toBe(true);
    useTroop.getState().chooseHeuristic();
    expect(useTroop.getState()).toMatchObject({ heuristic: true, keyDialog: false });
    expect(canThink(useTroop.getState())).toBe(false);
    expect(saved().heuristic).toBe(true);
    expect(ls.get("jamming:key-asked")).toBe("1");
  });

  it("closing changes nothing, but doesn't come back by itself", () => {
    useTroop.setState({ keyDialog: true });
    useTroop.getState().closeKeyDialog();
    expect(useTroop.getState()).toMatchObject({ keyDialog: false, heuristic: false, apiKey: "", anthropicKey: "" });
    expect(ls.get("jamming:key-asked")).toBe("1");
    expect(ls.has("improv-troop:v1")).toBe(false);
  });

  it("a key added later brings the band's brain back", () => {
    useTroop.getState().chooseHeuristic();
    useTroop.getState().setAnthropicKey(FAKE_ANTHROPIC);
    expect(useTroop.getState().heuristic).toBe(false);
    expect(canThink(useTroop.getState())).toBe(true);
    // clearing a key doesn't switch the heuristic band on or off
    useTroop.getState().setHeuristic(true);
    useTroop.getState().setAnthropicKey("");
    expect(useTroop.getState().heuristic).toBe(true);
  });
});
