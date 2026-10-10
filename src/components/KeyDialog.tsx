"use client";

import { useEffect, useId, useRef, useState } from "react";
import { detectKey, KEY_PROVIDER_LABEL, type KeyProvider } from "@/ai/keys";
import { useTroop } from "@/state/store";
import { RoughBox, RoughButton } from "./ui/rough";

/** What each key gets the band, said next to the detected provider. */
const REACH: Record<KeyProvider, string> = {
  anthropic: "Claude models, called straight at Anthropic",
  gateway: "every model here, Claude, GPT and Gemini alike",
};

type Check = { state: "idle" } | { state: "checking" } | { state: "rejected"; error: string };

/**
 * The welcome dialog: one field for an Anthropic or Vercel AI Gateway key (the prefix says
 * which), or the heuristic band. Opens by itself on a first visit (see shouldAskForKey) and
 * again from “Change key” in Brains & sounds.
 *
 * A native modal <dialog>: the page behind is inert, Tab cycles inside it, and Esc or × closes
 * it without changing anything (it won't reopen by itself; the key can be added later).
 */
export function KeyDialog() {
  const open = useTroop((s) => s.keyDialog);
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      // showModal focuses the first control (the ×); the key field is where they're headed
      d.querySelector("input")?.focus();
    } else if (!open && d.open) {
      d.close();
      // back where they were; if that's gone (the "add an AI key" link goes once there's a key)
      // or was nowhere (a first visit), on to the band's main button
      const back = opener.current;
      if (back && back.isConnected && back !== document.body) back.focus();
      else document.querySelector<HTMLElement>("[data-after-key]")?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="key-dialog"
      aria-labelledby="key-dialog-title"
      aria-describedby="key-dialog-desc"
      // Esc: the dialog closes through the store, so the page and the store agree
      onCancel={(e) => {
        e.preventDefault();
        useTroop.getState().closeKeyDialog();
      }}
      onKeyDown={trapTab}
    >
      {open && <KeyForm />}
    </dialog>
  );
}

/** Key prefixes (sk-ant-…, vck_…) kept on one line: "sk-ant-" broke at its hyphen on a phone. */
function keepPrefixes(text: string) {
  return text.split(/((?:sk-ant-|vck_)[\w…-]*)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Keep Tab inside the dialog: from the last control back to the first, and the other way round. */
function trapTab(e: React.KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== "Tab") return;
  const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled])")].filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function KeyForm() {
  const close = useTroop((s) => s.closeKeyDialog);
  const saveKey = useTroop((s) => s.saveKey);
  const chooseHeuristic = useTroop((s) => s.chooseHeuristic);
  const lends = useTroop((s) => s.serverKey || s.serverAnthropicKey);
  const saved = useTroop((s) => (s.apiKey ? "gateway" : s.anthropicKey ? "anthropic" : null));
  const heuristic = useTroop((s) => s.heuristic);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  // problems wait for a paste, leaving the field or pressing save, not every keystroke of a key being typed
  const [touched, setTouched] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const ids = useId();
  const statusId = `${ids}-status`;

  const guess = detectKey(value);
  const problem = check.state === "rejected" ? check.error : touched ? guess.problem : null;
  const checking = check.state === "checking";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!guess.ok || !guess.provider || checking) return;
    setCheck({ state: "checking" });
    let res: Response | null = null;
    try {
      res = await fetch("/api/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: guess.key }) });
    } catch {
      /* offline: save it anyway */
    }
    if (res?.status === 401 || res?.status === 400) {
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      setCheck({ state: "rejected", error: d?.error ?? "That key didn’t work." });
      return;
    }
    // accepted, or the provider couldn't be asked: a bad key still says so on the first take
    saveKey(guess.provider, guess.key);
  };

  return (
    <RoughBox seed="key-dialog" rough={{ weight: "l" }} className="key-dialog-paper p-l">
      <button
        type="button"
        onClick={close}
        className="absolute -right-xs -top-xs flex min-h-xl min-w-xl items-center justify-center text-l text-ink-soft transition-colors duration-(--motion-duration) hover:text-ink"
        aria-label="Close"
      >
        ×
      </button>
      <h2 id="key-dialog-title" className="type-section pr-xl">
        Give the band a brain?
      </h2>
      <p id="key-dialog-desc" className="mt-xs text-m">
        Paste an Anthropic or Vercel AI Gateway key and the animals talk every take through with a real model. No key? They play from their own sketchbook, a
        heuristic band that runs right here with no model calls.
      </p>

      <form onSubmit={submit} className="mt-m" noValidate>
        <div className="mb-xxs flex items-baseline justify-between gap-xs">
          <label htmlFor={`${ids}-key`} className="type-label">
            Your key
          </label>
          <span className="text-s text-ink-soft">stays in this browser</span>
        </div>
        <div className="flex items-center gap-xxs">
          <input
            id={`${ids}-key`}
            type={show ? "text" : "password"}
            className="sketch-input min-w-0 flex-1"
            placeholder="sk-ant-… or vck_…"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (check.state === "rejected") setCheck({ state: "idle" });
            }}
            onPaste={() => setTouched(true)}
            onBlur={() => value && setTouched(true)}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="done"
            aria-invalid={!!problem}
            aria-describedby={statusId}
          />
          {guess.provider && (
            <span className="key-badge shrink-0 px-xs text-s" data-provider={guess.provider}>
              {KEY_PROVIDER_LABEL[guess.provider]}
            </span>
          )}
          <button type="button" className="text-action px-xxs text-s" onClick={() => setShow((v) => !v)} aria-pressed={show}>
            {show ? "hide" : "show"}
          </button>
        </div>
        <p id={statusId} className="mt-xxs min-h-[calc(2*var(--line-s))] text-s" aria-live="polite">
          {problem ? (
            <span className="text-ink">
              <span aria-hidden className="text-(--error)">
                ✗{" "}
              </span>
              {keepPrefixes(problem)}
            </span>
          ) : checking && guess.provider ? (
            <span className="text-ink-soft">Checking with {KEY_PROVIDER_LABEL[guess.provider]}…</span>
          ) : guess.ok && guess.provider ? (
            <span className="text-ink">
              <span aria-hidden className="text-(--success)">
                ✓{" "}
              </span>
              {KEY_PROVIDER_LABEL[guess.provider]} key, for {REACH[guess.provider]}.
            </span>
          ) : (
            <span className="text-ink-soft">
              Anthropic keys start with {keepPrefixes("sk-ant-")}, AI Gateway keys with {keepPrefixes("vck_")}. Get one from{" "}
              <a className="text-action" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                Anthropic
              </a>{" "}
              or{" "}
              <a className="text-action" href="https://vercel.com/ai-gateway" target="_blank" rel="noreferrer">
                Vercel
              </a>
              .
            </span>
          )}
        </p>

        <div className="mt-m flex flex-wrap items-center gap-x-m gap-y-s">
          <RoughButton seed="key-save" tone="primary" type="submit" disabled={!guess.ok || checking} className="px-m py-xs font-brand text-l font-heavy text-on-accent">
            {checking ? "Checking…" : guess.ok && guess.provider ? `Save ${guess.provider === "anthropic" ? "Anthropic" : "Gateway"} key` : "Save key"}
          </RoughButton>
          <button type="button" className="text-action text-m" onClick={chooseHeuristic}>
            Skip — use the heuristic model
          </button>
        </div>
      </form>

      <p className="mt-m text-xs text-ink-soft">
        {lends && !heuristic
          ? "This server lends the band a key already, so you can close this and they’ll still think. Your own key spends your own credits. "
          : saved && !heuristic
            ? `Your ${KEY_PROVIDER_LABEL[saved]} key is saved; a new one of the same kind replaces it. `
            : ""}
        Your key is kept in this browser only and sent with each model call, through this site straight on to the provider. Nothing is logged or stored on the server.
        Change it any time in <b>Brains &amp; sounds</b>.
      </p>
    </RoughBox>
  );
}
