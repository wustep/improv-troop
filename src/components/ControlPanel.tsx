"use client";

import { useState } from "react";
import { AnimalPortrait } from "@/art/AnimalPortrait";
import { InstrumentIcon } from "@/art/InstrumentIcon";
import { modelsByProvider, PROVIDER_LABEL } from "@/ai/models";
import { lengthOptions } from "@/music/form";
import { ANIMAL_LIST, ANIMALS, INSTRUMENT_LIST, INSTRUMENTS } from "@/music/instruments";
import { STANDARDS, getStandard } from "@/music/standards";
import { STYLE_LIST, STYLES } from "@/music/styles";
import type { AnimalId, InstrumentId, Member } from "@/music/types";
import { useTroop } from "@/state/store";
import { RoughBox, RoughButton } from "./ui/rough";

function ModelSelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  return (
    <select className="sketch-select w-full" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {modelsByProvider().map((g) => (
        <optgroup key={g.provider} label={PROVIDER_LABEL[g.provider] ?? g.provider}>
          {g.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const TONICS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className="font-[family-name:var(--font-script)] text-xl font-bold">{children}</span>
      {hint && <span className="text-sm text-ink-soft">{hint}</span>}
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Chip({ seed, active, onClick, children, title, disabled }: { seed: string; active?: boolean; onClick?: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <RoughButton seed={seed} active={active} onClick={onClick} title={title} disabled={disabled} className="px-2.5 py-1 text-[15px]">
      {children}
    </RoughButton>
  );
}

function MemberRow({ m, members, onChange, onRemove }: { m: Member; members: Member[]; onChange: (m: Member) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-2">
        <AnimalPortrait animal={m.animal} size={40} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-[family-name:var(--font-script)] text-lg font-bold">{m.name}</div>
          <div className="text-xs text-ink-soft">{ANIMALS[m.animal].species}</div>
        </div>
        <RoughButton seed={`inst-${m.id}`} className="flex items-center gap-1 px-2 py-0.5 text-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Choose instrument">
          <InstrumentIcon instrument={m.instrument} size={24} />
          <span>{INSTRUMENTS[m.instrument].name}</span>
        </RoughButton>
        <button
          type="button"
          className="px-1 text-lg leading-none text-ink-soft hover:text-[var(--pencil-red)] disabled:opacity-30"
          onClick={onRemove}
          disabled={members.length <= 1}
          aria-label={`Remove ${m.name}`}
          title={`Send ${m.name} home`}
        >
          ×
        </button>
      </div>
      {open && (
        <div className="mt-1.5 grid grid-cols-4 gap-1 pl-12">
          {INSTRUMENT_LIST.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onChange({ ...m, instrument: id as InstrumentId });
                setOpen(false);
              }}
              className={`flex flex-col items-center rounded px-1 py-0.5 text-[11px] leading-tight hover:bg-[rgba(226,169,59,0.25)] ${id === m.instrument ? "bg-[rgba(226,169,59,0.4)]" : ""}`}
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

export function ControlPanel() {
  const s = useTroop((x) => x.settings);
  const members = useTroop((x) => x.members);
  const apiKey = useTroop((x) => x.apiKey);
  const pianoPack = useTroop((x) => x.pianoPack);
  const set = useTroop((x) => x.setSettings);
  const setStyle = useTroop((x) => x.setStyle);
  const setStandard = useTroop((x) => x.setStandard);
  const setMembers = useTroop((x) => x.setMembers);
  const setApiKey = useTroop((x) => x.setApiKey);
  const setPianoPack = useTroop((x) => x.setPianoPack);
  const [showKey, setShowKey] = useState(false);
  const std = getStandard(s.standard);
  const lengths = lengthOptions(s.standard);
  const free = ANIMAL_LIST.filter((a) => !members.some((m) => m.animal === a));
  const leaders = members.filter((m) => m.instrument !== "drums");

  const toggleSoloist = (id: string) => {
    const has = s.soloists.includes(id);
    set({ soloists: has ? s.soloists.filter((x) => x !== id) : [...s.soloists, id] });
  };

  return (
    <RoughBox seed="panel" rough={{ strokeWidth: 1.8 }} className="panel-paper w-full p-4" as="aside" aria-label="Band settings">
      <Field>
        <Label>Mode</Label>
        <div className="grid grid-cols-2 gap-2">
          <RoughButton seed="mode-imp" active={s.mode === "improviser"} onClick={() => set({ mode: "improviser" })} className="px-2 py-1.5 text-left">
            <div className="font-[family-name:var(--font-script)] text-lg font-bold leading-none">Improviser</div>
            <div className="text-xs leading-tight text-ink-soft">the animals talk it out</div>
          </RoughButton>
          <RoughButton seed="mode-comp" active={s.mode === "composer"} onClick={() => set({ mode: "composer" })} className="px-2 py-1.5 text-left">
            <div className="font-[family-name:var(--font-script)] text-lg font-bold leading-none">Composer</div>
            <div className="text-xs leading-tight text-ink-soft">a director writes the chart</div>
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
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-sm text-ink-soft">invite:</span>
            {free.map((a: AnimalId) => (
              <button
                key={a}
                type="button"
                onClick={() => setMembers([...members, { id: a, animal: a, name: ANIMALS[a].name, instrument: ANIMALS[a].defaultInstrument }])}
                className="rounded-full p-0.5 hover:bg-[rgba(226,169,59,0.3)]"
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
        <div className="flex flex-wrap gap-1.5">
          {STYLE_LIST.map((id) => (
            <Chip key={id} seed={`style-${id}`} active={s.style === id} onClick={() => setStyle(id)}>
              {STYLES[id].name}
            </Chip>
          ))}
        </div>
      </Field>

      <Field>
        <Label hint={std?.note}>Tune</Label>
        <select
          className="sketch-select w-full"
          value={s.standard ?? ""}
          onChange={(e) => setStandard(e.target.value || null)}
          aria-label="Tune"
        >
          <option value="">An original (the band writes the changes)</option>
          <optgroup label="Play a standard">
            {STANDARDS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>

      <Field>
        <Label hint={std ? `${std.bars.length}-bar choruses` : "locked — the band fills it"}>Length</Label>
        <div className="flex flex-wrap gap-1.5">
          {lengths.map((b) => (
            <Chip key={b} seed={`len-${b}`} active={s.bars === b} onClick={() => set({ bars: b })}>
              {b} bars
            </Chip>
          ))}
        </div>
      </Field>

      <div className="mb-4 grid grid-cols-2 gap-3">
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
          <div className="flex gap-1">
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
            >
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
          </div>
        </div>
      </div>

      <Field>
        <Label hint={std ? "set by the tune" : undefined}>Meter</Label>
        <div className="flex gap-1.5">
          {[4, 3].map((b) => (
            <Chip key={b} seed={`meter-${b}`} active={(std?.meter ?? s.meter.beats) === b} disabled={!!std} onClick={() => set({ meter: { beats: b } })}>
              {b}/4
            </Chip>
          ))}
        </div>
      </Field>

      <Field>
        <Label>Leader</Label>
        <div className="flex flex-wrap gap-1.5">
          {leaders.map((m) => (
            <Chip key={m.id} seed={`lead-${m.id}`} active={s.leaderId === m.id} onClick={() => set({ leaderId: m.id })}>
              {m.name}
            </Chip>
          ))}
        </div>
      </Field>

      <Field>
        <Label hint="tap in solo order">Solos</Label>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const idx = s.soloists.indexOf(m.id);
            return (
              <Chip key={m.id} seed={`solo-${m.id}`} active={idx >= 0} onClick={() => toggleSoloist(m.id)}>
                {idx >= 0 && <span className="mr-1 font-bold">{idx + 1}.</span>}
                {m.name}
                {m.instrument === "drums" && <span className="text-xs text-ink-soft"> (trades)</span>}
              </Chip>
            );
          })}
        </div>
      </Field>

      {s.mode === "improviser" && (
        <Field>
          <Label hint="bars per round of talk">Phrase</Label>
          <div className="flex gap-1.5">
            {[2, 4, 8].map((p) => (
              <Chip key={p} seed={`phrase-${p}`} active={s.phraseBars === p} onClick={() => set({ phraseBars: p })}>
                {p} bars
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <details className="group mb-1">
        <summary className="cursor-pointer list-none font-[family-name:var(--font-script)] text-xl font-bold">
          <span className="inline-block transition-transform group-open:rotate-90">▸</span> Brains &amp; sounds
        </summary>
        <div className="mt-2 space-y-3">
          <div>
            <Label hint="stays in this browser">AI Gateway key</Label>
            <div className="flex gap-1">
              <input
                type={showKey ? "text" : "password"}
                className="sketch-input min-w-0 flex-1"
                placeholder="vck_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label="Vercel AI Gateway key"
              />
              <button type="button" className="px-1 text-sm text-ink-soft underline" onClick={() => setShowKey((v) => !v)}>
                {showKey ? "hide" : "show"}
              </button>
            </div>
            <p className="mt-1 text-xs leading-snug text-ink-soft">
              Without a key the band plays from its own sketchbook — no model calls. Models are only called when you press the big button.
            </p>
          </div>
          <div>
            <Label>{s.mode === "composer" ? "Director" : "Leader"} model</Label>
            <ModelSelect value={s.directorModel} onChange={(id) => set({ directorModel: id })} label={s.mode === "composer" ? "Director model" : "Leader model"} />
          </div>
          {s.mode === "improviser" && (
            <div>
              <Label>Bandmates model</Label>
              <ModelSelect value={s.playerModel} onChange={(id) => set({ playerModel: id })} label="Bandmates model" />
            </div>
          )}
          <div>
            <Label hint="others: open sampled packs">Piano samples</Label>
            <select className="sketch-select w-full" value={pianoPack} onChange={(e) => setPianoPack(e.target.value as typeof pianoPack)} aria-label="Piano samples">
              <option value="salamander">Salamander Grand (heavier, richest)</option>
              <option value="splendid">Splendid Grand</option>
              <option value="soundfont">General MIDI piano (lightest)</option>
            </select>
          </div>
        </div>
      </details>
    </RoughBox>
  );
}
