"use client";

import { useRef, useState } from "react";
import { AnimalPortrait } from "@/art/AnimalPortrait";
import { InstrumentIcon } from "@/art/InstrumentIcon";
import { canRun, isClaude, keyMismatch, type KeyAccess } from "@/ai/keys";
import { modelInfo, modelsByProvider, PROVIDER_LABEL } from "@/ai/models";
import { lengthOptions } from "@/music/form";
import { ANIMAL_LIST, ANIMALS, INSTRUMENT_LIST, INSTRUMENTS } from "@/music/instruments";
import { STANDARDS, getStandard, searchStandards } from "@/music/standards";
import { STYLE_LIST, STYLES } from "@/music/styles";
import type { AnimalId, InstrumentId, Member } from "@/music/types";
import type { Sounds } from "@/audio/packs";
import { keyAccess, useTroop } from "@/state/store";
import { RoughBox, RoughButton } from "./ui/rough";

/** The tune list, grouped by what you get: a song with its melody, jazz changes, pop chords, a groove. */
const TUNE_GROUPS: { label: string; has: (t: (typeof STANDARDS)[number]) => boolean }[] = [
  { label: "Songs (the band plays the melody)", has: (t) => !!t.melody },
  { label: "Jazz standards (the changes)", has: (t) => !t.melody && ["swing", "bossa"].includes(t.style) },
  { label: "Pop progressions", has: (t) => !t.melody && t.style === "pop" },
  { label: "Grooves and grounds", has: (t) => !t.melody && !["swing", "bossa", "pop"].includes(t.style) },
];

/** Every model; with only an Anthropic key, the other providers' models are greyed out (they need the gateway). */
function ModelSelect({ value, onChange, label, access }: { value: string; onChange: (id: string) => void; label: string; access: KeyAccess }) {
  const claudeOnly = !access.gateway && access.anthropic;
  return (
    <>
      <select className="sketch-select w-full" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {modelsByProvider().map((g) => (
          <optgroup key={g.provider} label={`${PROVIDER_LABEL[g.provider] ?? g.provider}${claudeOnly && g.provider !== "anthropic" ? " (needs an AI Gateway key)" : ""}`}>
            {g.models.map((m) => (
              <option key={m.id} value={m.id} disabled={claudeOnly && !isClaude(m.id)}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {claudeOnly && !canRun(value, access) && (
        <p className="mt-xxs text-xs text-ink">
          <span aria-hidden className="text-(--error)">✗ </span>
          {modelInfo(value)?.label ?? value} needs an AI Gateway key. Pick a Claude model to use your Anthropic key.
        </p>
      )}
    </>
  );
}

/** A key that stays in this browser: hidden by default, with show/hide and clear. */
function KeyField({ id, label, value, placeholder, onChange, mismatch }: { id: string; label: string; value: string; placeholder: string; onChange: (key: string) => void; mismatch: string | null }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <div className="flex gap-xxs">
        <input
          type={show ? "text" : "password"}
          className="sketch-input min-w-0 flex-1"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          id={id}
        />
        <button type="button" className="text-action px-xxs text-s" onClick={() => setShow((v) => !v)}>
          {show ? "hide" : "show"}
        </button>
        {value && (
          <button type="button" className="text-action px-xxs text-s" onClick={() => onChange("")} aria-label={`Clear ${label}`}>
            clear
          </button>
        )}
      </div>
      {mismatch && (
        <p className="mt-xxs text-xs text-ink">
          <span aria-hidden className="text-(--error)">✗ </span>
          {mismatch}
        </p>
      )}
    </>
  );
}

const TONICS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-xxs flex items-baseline justify-between gap-xs">
      <span className="type-label">{children}</span>
      {hint && <span className="text-s text-ink-soft">{hint}</span>}
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-m">{children}</div>;
}

function Chip({ seed, active, onClick, children, title, disabled }: { seed: string; active?: boolean; onClick?: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <RoughButton seed={seed} active={active} onClick={onClick} title={title} disabled={disabled} className="px-xs py-xxs text-m">
      {children}
    </RoughButton>
  );
}

function MemberRow({ m, members, onChange, onRemove }: { m: Member; members: Member[]; onChange: (m: Member) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-xs">
      <div className="flex items-center gap-xs">
        <AnimalPortrait animal={m.animal} size={40} />
        <div className="min-w-0 flex-1">
          <div className="type-label truncate">{m.name}</div>
          <div className="text-xs text-ink-soft">{ANIMALS[m.animal].species}</div>
        </div>
        <RoughButton seed={`inst-${m.id}`} className="flex items-center gap-xxs px-xs py-xxs text-s" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Choose instrument">
          <InstrumentIcon instrument={m.instrument} size={24} />
          <span>{INSTRUMENTS[m.instrument].name}</span>
        </RoughButton>
        <button
          type="button"
          // a finger-sized target (the × alone was 18 px wide)
          className="flex min-h-xl min-w-xl items-center justify-center text-l text-ink-soft transition-colors duration-(--motion-duration) hover:text-(--color-1) disabled:opacity-30"
          onClick={onRemove}
          disabled={members.length <= 1}
          aria-label={`Remove ${m.name}`}
          title={`Send ${m.name} home`}
        >
          ×
        </button>
      </div>
      {open && (
        <div className="mt-xs grid grid-cols-4 gap-xxs pl-xxl">
          {INSTRUMENT_LIST.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onChange({ ...m, instrument: id as InstrumentId });
                setOpen(false);
              }}
              aria-pressed={id === m.instrument}
              data-selected={id === m.instrument}
              className="pick flex flex-col items-center px-xxs py-xxs text-xxs"
              title={INSTRUMENTS[id].name}
            >
              <InstrumentIcon instrument={id} size={30} />
              {INSTRUMENTS[id].name.replace("Upright ", "").replace("Tenor ", "")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Open “Brains & sounds”, bring it into view and put the cursor in the key field. */
export function openBrains() {
  const details = document.getElementById("brains") as HTMLDetailsElement | null;
  if (!details) return;
  details.open = true;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  details.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  // the field they're using: the Anthropic one when that's their only key
  const { apiKey, anthropicKey } = useTroop.getState();
  document.getElementById(!apiKey && anthropicKey ? "anthropic-key" : "gateway-key")?.focus({ preventScroll: true });
}

/**
 * The tune dropdown with a search box over it: typing narrows the list (the tune already picked
 * always stays in it), Enter picks the first match, the down arrow drops into the list, Escape clears.
 */
function TunePicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLSelectElement>(null);
  const matches = searchStandards(query);
  const searching = query.trim().length > 0;
  const shown = (t: (typeof STANDARDS)[number]) => t.id === value || matches.includes(t);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searching && matches.length) {
      e.preventDefault();
      onChange(matches[0].id);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      listRef.current?.focus();
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  };

  return (
    <div>
      <input
        type="search"
        className="sketch-input mb-xxs w-full"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Search ${STANDARDS.length} tunes: name, key, feel…`}
        aria-label="Search tunes"
        aria-controls="tune-list"
        aria-describedby={searching ? "tune-search-status" : undefined}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      <select id="tune-list" ref={listRef} className="sketch-select w-full" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Tune">
        <option value="">An original (the band writes the changes)</option>
        {TUNE_GROUPS.map((g) => {
          const tunes = STANDARDS.filter((t) => g.has(t) && shown(t));
          return tunes.length ? (
            <optgroup key={g.label} label={g.label}>
              {tunes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
      <div id="tune-search-status" role="status" aria-live="polite" className="mt-xxs text-s text-ink-soft">
        {searching &&
          (matches.length ? (
            `${matches.length} of ${STANDARDS.length} tunes match · Enter picks ${matches[0].name}`
          ) : (
            <>
              No tunes match “{query.trim()}”.{" "}
              <button type="button" className="text-action" onClick={() => setQuery("")}>
                Clear search
              </button>
            </>
          ))}
      </div>
    </div>
  );
}

export function ControlPanel() {
  const s = useTroop((x) => x.settings);
  const members = useTroop((x) => x.members);
  const apiKey = useTroop((x) => x.apiKey);
  const anthropicKey = useTroop((x) => x.anthropicKey);
  const serverKey = useTroop((x) => x.serverKey);
  const serverAnthropicKey = useTroop((x) => x.serverAnthropicKey);
  const heuristic = useTroop((x) => x.heuristic);
  const access = keyAccess({ apiKey, anthropicKey, serverKey, serverAnthropicKey, heuristic });
  const thinks = access.gateway || access.anthropic;
  const sounds = useTroop((x) => x.sounds);
  const set = useTroop((x) => x.setSettings);
  const setStyle = useTroop((x) => x.setStyle);
  const setStandard = useTroop((x) => x.setStandard);
  const setMembers = useTroop((x) => x.setMembers);
  const setApiKey = useTroop((x) => x.setApiKey);
  const setAnthropicKey = useTroop((x) => x.setAnthropicKey);
  const setSounds = useTroop((x) => x.setSounds);
  const openKeyDialog = useTroop((x) => x.openKeyDialog);
  const setHeuristic = useTroop((x) => x.setHeuristic);
  const std = getStandard(s.standard);
  const lengths = lengthOptions(s.standard);
  const free = ANIMAL_LIST.filter((a) => !members.some((m) => m.animal === a));
  const leaders = members.filter((m) => m.instrument !== "drums");

  const toggleSoloist = (id: string) => {
    const has = s.soloists.includes(id);
    set({ soloists: has ? s.soloists.filter((x) => x !== id) : [...s.soloists, id] });
  };

  return (
    <RoughBox seed="panel" rough={{ weight: "l" }} className="panel-paper w-full p-m" as="aside" aria-label="Band settings">
      <Field>
        <Label hint={thinks ? undefined : "how they think, once they have a key"}>Mode</Label>
        <div className="grid grid-cols-2 gap-xs">
          <RoughButton seed="mode-imp" active={s.mode === "improviser"} onClick={() => set({ mode: "improviser" })} className="px-xs py-xs text-left">
            <div className="type-label">Improviser</div>
            <div className="text-xs text-ink-soft">the animals talk it out</div>
          </RoughButton>
          <RoughButton seed="mode-comp" active={s.mode === "composer"} onClick={() => set({ mode: "composer" })} className="px-xs py-xs text-left">
            <div className="type-label">Composer</div>
            <div className="text-xs text-ink-soft">a director writes the chart</div>
          </RoughButton>
        </div>
      </Field>

      <Field>
        <Label hint={`${members.length}/6 on stage`}>The band</Label>
        {members.map((m) => (
          <MemberRow
            key={m.id}
            m={m}
            members={members}
            onChange={(next) => setMembers(members.map((x) => (x.id === m.id ? next : x)))}
            onRemove={() => setMembers(members.filter((x) => x.id !== m.id))}
          />
        ))}
        {members.length < 6 && free.length > 0 && (
          <div className="mt-xs flex flex-wrap items-center gap-xxs">
            <span className="mr-xxs text-s text-ink-soft">invite:</span>
            {free.map((a: AnimalId) => (
              <button
                key={a}
                type="button"
                onClick={() => setMembers([...members, { id: a, animal: a, name: ANIMALS[a].name, instrument: ANIMALS[a].defaultInstrument }])}
                className="pick rounded-full p-xxs"
                title={`Invite ${ANIMALS[a].name} the ${ANIMALS[a].species}`}
                aria-label={`Invite ${ANIMALS[a].name}`}
              >
                <AnimalPortrait animal={a} size={34} />
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field>
        <Label hint={STYLES[s.style].blurb}>Style</Label>
        <div className="flex flex-wrap gap-xs">
          {STYLE_LIST.map((id) => (
            <Chip key={id} seed={`style-${id}`} active={s.style === id} onClick={() => setStyle(id)}>
              {STYLES[id].name}
            </Chip>
          ))}
        </div>
      </Field>

      <Field>
        <Label hint={std?.note}>Tune</Label>
        <TunePicker value={s.standard} onChange={setStandard} />
      </Field>

      <Field>
        <Label hint={std ? `times through the ${std.bars.length}-bar tune` : "bars in the take"}>Length</Label>
        <div className="flex flex-wrap gap-xs">
          {lengths.map((b) => (
            // a standard is played in choruses: once through, twice, three times...
            <Chip key={b} seed={`len-${b}`} active={s.bars === b} onClick={() => set({ bars: b })} title={std ? `${b} bars` : undefined}>
              {std ? (b === std.bars.length ? "once" : `${b / std.bars.length}×`) : `${b} bars`}
            </Chip>
          ))}
        </div>
      </Field>

      <div className="mb-m grid grid-cols-2 gap-s">
        <div>
          <Label hint={`${s.tempo} bpm`}>Tempo</Label>
          <input
            type="range"
            className="sketch-range w-full"
            min={STYLES[s.style].tempo.min - 20}
            max={STYLES[s.style].tempo.max + 20}
            value={s.tempo}
            onChange={(e) => set({ tempo: parseInt(e.target.value, 10) })}
            aria-label="Tempo"
          />
        </div>
        <div>
          <Label>Key</Label>
          <div className="flex gap-xxs">
            <select className="sketch-select min-w-0 flex-1" value={s.key.tonic} onChange={(e) => set({ key: { ...s.key, tonic: e.target.value } })} aria-label="Key">
              {TONICS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              className="sketch-select min-w-0 flex-1"
              value={s.key.mode}
              onChange={(e) => set({ key: { ...s.key, mode: e.target.value as "major" | "minor" } })}
              aria-label="Mode"
              disabled={!!s.standard}
              title={s.standard ? "A standard keeps its own mode; pick any key for it" : undefined}
            >
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
          </div>
        </div>
      </div>

      <Field>
        <Label hint={std ? "set by the tune" : undefined}>Meter</Label>
        <div className="flex gap-xs">
          {[4, 3].map((b) => (
            <Chip key={b} seed={`meter-${b}`} active={(std?.meter ?? s.meter.beats) === b} disabled={!!std} onClick={() => set({ meter: { beats: b } })}>
              {b}/4
            </Chip>
          ))}
        </div>
      </Field>

      {STYLES[s.style].swing > 0.5 && (
        <Field>
          <Label hint="how far the 8ths lean">Swing</Label>
          <div className="flex gap-xs">
            {(["light", "medium", "hard"] as const).map((f) => (
              <Chip key={f} seed={`swing-${f}`} active={(s.swingFeel ?? "medium") === f} onClick={() => set({ swingFeel: f })}>
                {f}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <Field>
        <Label>Leader</Label>
        <div className="flex flex-wrap gap-xs">
          {leaders.map((m) => (
            <Chip key={m.id} seed={`lead-${m.id}`} active={s.leaderId === m.id} onClick={() => set({ leaderId: m.id })}>
              {m.name}
            </Chip>
          ))}
        </div>
      </Field>

      <Field>
        <Label hint="tap in solo order">Solos</Label>
        <div className="flex flex-wrap gap-xs">
          {members.map((m) => {
            const idx = s.soloists.indexOf(m.id);
            return (
              <Chip key={m.id} seed={`solo-${m.id}`} active={idx >= 0} onClick={() => toggleSoloist(m.id)}>
                {idx >= 0 && <span className="mr-xxs font-heavy">{idx + 1}.</span>}
                {m.name}
                {m.instrument === "drums" && <span className="text-xs text-ink-soft"> (trades)</span>}
              </Chip>
            );
          })}
        </div>
      </Field>

      {/* only the model-driven band talks in rounds; without a key it does nothing */}
      {s.mode === "improviser" && thinks && (
        <Field>
          <Label hint="how much each player writes before the band answers">Phrase</Label>
          <div className="flex gap-xs">
            {[2, 4, 8].map((p) => (
              <Chip key={p} seed={`phrase-${p}`} active={s.phraseBars === p} onClick={() => set({ phraseBars: p })}>
                {p} bars
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <details id="brains" className="group mb-xxs">
        <summary className="type-label cursor-pointer list-none">
          <span className="inline-block transition-transform duration-(--motion-duration) ease-small group-open:rotate-90">▸</span> Brains &amp; sounds
        </summary>
        <div className="mt-xs space-y-s">
          <div>
            <Label>Brain</Label>
            <div className="flex flex-wrap items-baseline justify-between gap-x-s gap-y-xxs">
              <p className="text-m">
                {heuristic
                  ? "The heuristic band: no model calls."
                  : apiKey
                    ? "Your Vercel AI Gateway key."
                    : anthropicKey
                      ? "Your Anthropic key (Claude models)."
                      : serverKey || serverAnthropicKey
                        ? "A key this server lends."
                        : "The heuristic band, until you add a key."}
              </p>
              <button type="button" className="text-action text-s" onClick={openKeyDialog} aria-haspopup="dialog">
                {apiKey || anthropicKey ? "Change key" : "Add a key"}
              </button>
            </div>
            {heuristic && (apiKey || anthropicKey || serverKey || serverAnthropicKey) && (
              <p className="mt-xxs text-xs text-ink-soft">
                {apiKey || anthropicKey ? "Your key is still saved here." : "This server lends a key."}{" "}
                <button type="button" className="text-action" onClick={() => setHeuristic(false)}>
                  Let them think with it
                </button>
              </p>
            )}
          </div>
          <div>
            <Label hint="stays in this browser">AI Gateway key</Label>
            <KeyField id="gateway-key" label="Vercel AI Gateway key" placeholder="vck_…" value={apiKey} onChange={setApiKey} mismatch={keyMismatch("gateway", apiKey)} />
            {apiKey && !heuristic ? (
              <p className="mt-xxs text-xs text-ink-soft">
                Saved in this browser. The big button now says <b>{s.mode === "composer" ? "Compose!" : "Let them jam!"}</b>, and models are only called when you press it.
              </p>
            ) : apiKey ? (
              <p className="mt-xxs text-xs text-ink-soft">Saved in this browser.</p>
            ) : serverKey && !heuristic ? (
              <p className="mt-xxs text-xs text-ink-soft">
                This server lends the band its own key, so they can think already. Add yours to spend your own credits.
              </p>
            ) : anthropicKey || serverAnthropicKey ? (
              <p className="mt-xxs text-xs text-ink-soft">Optional with an Anthropic key: the gateway adds GPT and Gemini models.</p>
            ) : (
              <p className="mt-xxs text-xs text-ink-soft">
                Without a key the band plays from its own sketchbook, with no model calls.{" "}
                <a className="text-action" href="https://vercel.com/ai-gateway" target="_blank" rel="noreferrer">
                  Get a key from Vercel AI Gateway
                </a>
                , or add an Anthropic key below for Claude.
              </p>
            )}
          </div>
          <div>
            <Label hint="Claude models only">Anthropic key</Label>
            <KeyField id="anthropic-key" label="Anthropic API key" placeholder="sk-ant-…" value={anthropicKey} onChange={setAnthropicKey} mismatch={keyMismatch("anthropic", anthropicKey)} />
            <p className="mt-xxs text-xs text-ink-soft">
              {anthropicKey
                ? apiKey
                  ? "Saved in this browser. Your gateway key goes first; this one is used if you remove it."
                  : "Saved in this browser and sent only with each Claude call, straight on to Anthropic. The server never keeps it."
                : serverAnthropicKey && !serverKey && !apiKey
                  ? "This server lends the band an Anthropic key for Claude models. Add yours to spend your own credits."
                  : "Optional: Claude models can call Anthropic directly with your own key."}{" "}
              {!anthropicKey && (
                <a className="text-action" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  Get one from Anthropic
                </a>
              )}
            </p>
          </div>
          <div>
            <Label>{s.mode === "composer" ? "Director" : "Leader"} model</Label>
            <ModelSelect value={s.directorModel} onChange={(id) => set({ directorModel: id })} label={s.mode === "composer" ? "Director model" : "Leader model"} access={access} />
          </div>
          {s.mode === "improviser" && (
            <div>
              <Label>Bandmates model</Label>
              <ModelSelect value={s.playerModel} onChange={(id) => set({ playerModel: id })} label="Bandmates model" access={access} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-s">
            <div>
              <Label>Piano sound</Label>
              <select className="sketch-select w-full" value={sounds.piano} onChange={(e) => setSounds({ piano: e.target.value as Sounds["piano"] })} aria-label="Piano sound">
                <optgroup label="Grand piano">
                  <option value="salamander">Salamander (richest)</option>
                  <option value="splendid">Splendid</option>
                  <option value="soundfont">General MIDI (lightest)</option>
                </optgroup>
                <optgroup label="Electric">
                  <option value="wurlitzer">Wurlitzer</option>
                  <option value="cp80">Yamaha CP80</option>
                </optgroup>
              </select>
            </div>
            <div>
              <Label>Drum kit</Label>
              <select className="sketch-select w-full" value={sounds.drums} onChange={(e) => setSounds({ drums: e.target.value as Sounds["drums"] })} aria-label="Drum kit">
                <option value="acoustic">Acoustic kit</option>
                <option value="lm2">LinnDrum machine</option>
              </select>
            </div>
            <div>
              <Label>Room</Label>
              <select className="sketch-select w-full" value={sounds.room} onChange={(e) => setSounds({ room: e.target.value as Sounds["room"] })} aria-label="Room">
                <option value="dry">Dry (close up)</option>
                <option value="club">Club</option>
                <option value="hall">Hall (big and wet)</option>
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-xs self-end pb-xxs text-m" title="A bar of clicks before a take from the top">
              <input type="checkbox" className="sketch-check" checked={sounds.countIn} onChange={(e) => setSounds({ countIn: e.target.checked })} />
              count me in
            </label>
          </div>
        </div>
      </details>
    </RoughBox>
  );
}
