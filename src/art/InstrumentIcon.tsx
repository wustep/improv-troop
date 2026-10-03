import type { ReactNode } from "react";
import type { InstrumentId } from "@/music/types";
import { INSTRUMENTS } from "@/music/instruments";
import { L, S, ellipsePath, hash, rectPath } from "./sketch";

const INK = "#2c2a35";
const BRASS = "#f2c14e";
const BRASS_INK = "#8a6418";
const WOOD = "#e29a55";
const WOOD_INK = "#6b3a12";
const RED = "#e0786d";

function icon(i: InstrumentId): ReactNode {
  const s = hash("icon" + i);
  const o = { rough: 0.7, w: 1.5, seed: s };
  switch (i) {
    case "piano":
      return (
        <>
          <S d={rectPath(4, 14, 40, 22, 3)} ink={INK} base="#fffdf4" {...o} />
          <L d="M10 14 V36 M16 14 V36 M22 14 V36 M28 14 V36 M34 14 V36 M40 14 V36" ink={INK} seed={s + 1} w={0.8} />
          <path d="M8.5 14 h3 v12 h-3 Z M14.5 14 h3 v12 h-3 Z M26.5 14 h3 v12 h-3 Z M32.5 14 h3 v12 h-3 Z M38.5 14 h3 v12 h-3 Z" fill={INK} />
        </>
      );
    case "bass":
      return (
        <>
          <S d="M24 20 C16 20 13 25 15 30 C10 33 10 44 24 45 C38 44 38 33 33 30 C35 25 32 20 24 20 Z" ink={WOOD_INK} base={WOOD} hatch="#c27a3d" gap={2.6} {...o} />
          <L d="M24 21 V3 M22 34 h4" ink={WOOD_INK} seed={s + 2} w={2.2} />
          <L d="M23 26 v12 M25 26 v12" ink="#2c2a35" seed={s + 3} w={0.7} />
        </>
      );
    case "drums":
      return (
        <>
          <S d="M8 22 V36 Q24 44 40 36 V22 Z" ink={INK} base={RED} hatch="#c8463c" gap={2.6} {...o} />
          <S d={ellipsePath(24, 22, 16, 5)} ink={INK} base="#fffaf0" {...o} seed={s + 1} />
          <L d="M10 4 L22 19 M38 4 L26 19" ink="#8a5a2b" seed={s + 2} w={2.4} />
        </>
      );
    case "trumpet":
      return (
        <>
          <S d="M3 25 H32 V28 H3 Z" ink={BRASS_INK} base={BRASS} {...o} />
          <S d="M30 24 Q38 23 45 15 V38 Q38 30 30 29 Z" ink={BRASS_INK} base={BRASS} hatch="#d9a12e" gap={2.4} {...o} seed={s + 1} />
          <L d="M14 25 v-7 M19 25 v-7 M24 25 v-7 M12 28 q0 6 6 6 h8 q4 0 4 -5" ink={BRASS_INK} seed={s + 2} w={1.6} />
        </>
      );
    case "sax":
      return (
        <>
          <S d="M10 6 Q20 6 22 14 L26 36 Q28 44 34 42 L40 26 L44 24 L42 20 L34 22 L30 36 Q29 38 28 36 L24 12 Q22 3 10 4 Z" ink={BRASS_INK} base={BRASS} hatch="#d9a12e" gap={2.4} {...o} />
          <circle cx={24.5} cy={20} r={1.6} fill="#fffaf0" stroke={INK} strokeWidth={0.8} />
          <circle cx={25.5} cy={26} r={1.6} fill="#fffaf0" stroke={INK} strokeWidth={0.8} />
          <circle cx={26.5} cy={32} r={1.6} fill="#fffaf0" stroke={INK} strokeWidth={0.8} />
        </>
      );
    case "trombone":
      return (
        <>
          <L d="M3 24 H40 M3 29 H40 M40 24 Q44 26.5 40 29" ink={BRASS_INK} seed={s} w={1.8} />
          <S d="M6 18 H22 Q30 17 36 10 V28 Q30 21 22 21 H6 Z" ink={BRASS_INK} base={BRASS} hatch="#d9a12e" gap={2.4} {...o} seed={s + 1} />
        </>
      );
    case "clarinet":
      return (
        <>
          <S d="M12 4 L15 3 L35 38 L32 40 Z" ink="#1f1c26" base="#3b3446" {...o} />
          <S d="M31 37 L36 34 Q40 40 42 45 L33 45 Q33 41 31 37 Z" ink="#1f1c26" base="#3b3446" {...o} seed={s + 1} />
          <path d="M18 12 l2 -1 M22 19 l2 -1 M26 26 l2 -1" stroke="#c9c5d6" strokeWidth={1.6} />
        </>
      );
    case "flute":
      return (
        <>
          <S d="M2 22 L46 18 L46 22 L2 26 Z" ink="#5d5870" base="#e3e2ea" {...o} />
          {[14, 20, 26, 32, 38].map((x, k) => (
            <circle key={k} cx={x} cy={23 - (x / 46) * 4} r={1.3} fill={INK} />
          ))}
        </>
      );
    case "violin":
      return (
        <>
          <g transform="rotate(-35 24 24)">
            <S d="M8 24 C8 17 14 16 17 19 C19 20 21 20 23 19 C26 16 32 17 32 24 C32 31 26 32 23 29 C21 28 19 28 17 29 C14 32 8 31 8 24 Z" ink={WOOD_INK} base={WOOD} hatch="#c0712f" gap={2.2} {...o} />
            <path d="M18 23 L44 23.5 L44 24.5 L18 25 Z" fill={INK} />
          </g>
          <L d="M6 10 L40 38" ink="#5a3418" seed={s + 2} w={1.4} />
        </>
      );
    case "cello":
      return (
        <>
          <S d="M24 14 C17 14 15 19 17 23 C13 26 12 38 24 39 C36 38 35 26 31 23 C33 19 31 14 24 14 Z" ink={WOOD_INK} base={WOOD} hatch="#c0712f" gap={2.4} {...o} />
          <L d="M24 15 V2 M24 39 V46 M20 30 h8" ink={WOOD_INK} seed={s + 2} w={1.8} />
          <L d="M4 30 L44 26" ink="#5a3418" seed={s + 3} w={1.2} />
        </>
      );
    case "guitar":
      return (
        <>
          <g transform="rotate(-30 24 24)">
            <S d="M2 26 C2 18 10 17 14 21 C16 22 18 22 20 21 C24 18 30 19 30 26 C30 33 24 34 20 31 C18 30 16 30 14 31 C10 35 2 34 2 26 Z" ink={WOOD_INK} base="#f3cf8e" hatch="#d9a65a" gap={2.4} {...o} />
            <circle cx={17} cy={26} r={3} fill="#3b2a1a" />
            <path d="M28 24.5 L46 25 L46 27 L28 27.5 Z" fill={WOOD_INK} />
          </g>
        </>
      );
    case "vibes":
      return (
        <>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <S key={k} d={rectPath(4 + k * 7, 18 + k, 5.5, 20 - k * 2.2, 1)} ink="#5d5870" base="#c9c5d6" {...o} seed={s + k} />
          ))}
          <L d="M14 4 L18 14 M34 4 L30 14" ink="#8a5a2b" seed={s + 9} w={1.4} />
          <circle cx={18.5} cy={15} r={3} fill="#c8463c" stroke={INK} strokeWidth={0.8} />
          <circle cx={29.5} cy={15} r={3} fill="#3b5bab" stroke={INK} strokeWidth={0.8} />
        </>
      );
  }
}

export function InstrumentIcon({ instrument, size = 40, className }: { instrument: InstrumentId; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} role="img" aria-label={INSTRUMENTS[instrument].name}>
      {icon(instrument)}
    </svg>
  );
}
