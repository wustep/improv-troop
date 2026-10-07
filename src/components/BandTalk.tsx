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
        <h2 className="type-section mb-xs">Band talk</h2>
        <p className="max-w-[60ch] text-m text-ink-soft">
          In <b>Improviser</b> mode the animals plan the tune together and talk between phrases. In <b>Composer</b> mode the director leaves notes on the chart.
        </p>
      </div>
    );
  }

  const nameOf = (id: string) => (id === "director" ? "Director" : id === "critic" ? "Judge" : (members.find((m) => m.id === id)?.name ?? id));
  return (
    <div>
      <h2 className="type-section mb-xs">Band talk</h2>
      {!msgs.length && (
        <p className="text-m text-ink-soft">
          the band is huddling<span className="thinking-dots" aria-hidden><i>.</i><i>.</i><i>.</i></span>
        </p>
      )}
      <ol ref={listRef} className="max-h-72 space-y-xs overflow-y-auto pr-xxs">
        {msgs.map((c, i) => {
          const m = members.find((x) => x.id === c.from);
          const to = c.to && c.to !== "band" ? nameOf(c.to) : null;
          const prev = msgs[i - 1];
          const divider =
            !prev || prev.phase !== c.phase || (c.phase === "jam" && prev.bar !== c.bar)
              ? c.phase === "jam" && c.bar !== undefined
                ? [`bar ${c.bar + 1}`, current?.plan[c.bar]?.section].filter(Boolean).join(" · ")
                : c.phase === "count-off"
                  ? "before the count-off"
                  : c.phase === "setup"
                    ? "the plan"
                    : null
              : null;
          return (
            <li key={c.id} className="flex flex-col gap-xxs">
              {divider && (
                <div className="flex items-center gap-xs text-xs text-ink-soft">
                  <span className="rule-top h-px flex-1" />
                  {divider}
                  <span className="rule-top h-px flex-1" />
                </div>
              )}
              <div className="flex gap-xs">
                <div className="shrink-0">{m ? <AnimalPortrait animal={m.animal} size={30} /> : <span className="inline-block w-[30px] text-center text-l">✎</span>}</div>
                <div className="min-w-0 text-m">
                  <span className="font-heavy">{nameOf(c.from)}</span>
                  {to && <span className="text-ink-soft"> → {to}</span>}
                  <div>{c.text}</div>
                </div>
              </div>
            </li>
          );
        })}
        {current?.critic?.summary && !running && (
          <li className="flex gap-xs">
            <span className="inline-block w-[30px] shrink-0 text-center text-l">⚖</span>
            <div className="text-m">
              <span className="font-heavy">Judge</span>
              <div>{current.critic.summary}</div>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}
