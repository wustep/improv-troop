"use client";

import { useEffect, useRef } from "react";
import { AnimalPortrait } from "@/art/AnimalPortrait";
import { useTroop } from "@/state/store";

export function BandTalk() {
  const chat = useTroop((s) => s.chat);
  const current = useTroop((s) => s.current);
  const running = useTroop((s) => s.gen.running);
  const msgs = chat.length ? chat : (current?.chat ?? []);
  const members = current?.members ?? [];
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  if (!msgs.length && !running) {
    return (
      <div>
        <div className="mb-1 font-[family-name:var(--font-script)] text-xl font-bold">Band talk</div>
        <p className="text-[15px] leading-snug text-ink-soft">
          In <b>Improviser</b> mode the animals plan the tune together and talk between phrases. In <b>Composer</b> mode the director leaves notes on the chart.
        </p>
      </div>
    );
  }

  const nameOf = (id: string) => (id === "director" ? "Director" : id === "critic" ? "Judge" : (members.find((m) => m.id === id)?.name ?? id));
  return (
    <div>
      <div className="mb-1 font-[family-name:var(--font-script)] text-xl font-bold">Band talk</div>
      <ol ref={listRef} className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {msgs.map((c) => {
          const m = members.find((x) => x.id === c.from);
          const to = c.to && c.to !== "band" ? nameOf(c.to) : null;
          return (
            <li key={c.id} className="flex gap-2">
              <div className="shrink-0">{m ? <AnimalPortrait animal={m.animal} size={30} /> : <span className="inline-block w-[30px] text-center text-xl">✎</span>}</div>
              <div className="min-w-0 text-[15px] leading-snug">
                <span className="font-bold">{nameOf(c.from)}</span>
                {to && <span className="text-ink-soft"> → {to}</span>}
                {c.bar !== undefined && c.phase === "jam" && <span className="ml-1 text-xs text-ink-soft">bar {c.bar + 1}</span>}
                <div>{c.text}</div>
              </div>
            </li>
          );
        })}
        {current?.critic?.summary && !running && (
          <li className="flex gap-2">
            <span className="inline-block w-[30px] shrink-0 text-center text-xl">⚖</span>
            <div className="text-[15px] leading-snug">
              <span className="font-bold">Judge</span>
              <div>{current.critic.summary}</div>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}
