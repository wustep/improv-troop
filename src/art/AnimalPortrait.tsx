import type { AnimalId } from "@/music/types";
import { ANIMALS } from "@/music/instruments";
import { Blush, animalArt, mouthPath } from "./animals";
import { L, PENCIL, hash } from "./sketch";

/** Head-only doodle for pickers and chat avatars. */
export function AnimalPortrait({ animal, size = 64, className }: { animal: AnimalId; size?: number; className?: string }) {
  const art = animalArt(animal);
  const def = ANIMALS[animal];
  const sd = hash(animal + "portrait");
  const mp = mouthPath(art.face.mouthStyle, art.face.mouth);
  const r = art.face.eyeR;
  return (
    <svg viewBox="30 0 180 170" width={size} height={(size * 170) / 180} className={className} role="img" aria-label={`${def.name} the ${def.species}`}>
      {art.ears?.map((e, i) => <g key={i}>{e.node}</g>)}
      {art.head}
      <Blush at={art.face.blush[0]} seed={sd} />
      <Blush at={art.face.blush[1]} seed={sd + 1} />
      {art.face.eyes.map((e, i) => (
        <g key={i} transform={`translate(${e.x} ${e.y})`}>
          <ellipse rx={r} ry={r * 1.1} fill={PENCIL} />
          <circle cx={-r * 0.32} cy={-r * 0.38} r={r * 0.34} fill="#fffdf4" />
        </g>
      ))}
      {art.front}
      {mp && <L d={mp} ink={PENCIL} seed={sd + 2} w={1.8} />}
    </svg>
  );
}
