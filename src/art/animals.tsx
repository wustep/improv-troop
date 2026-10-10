// The eight troop animals, drawn on a shared canonical layout so any
// instrument pose can be composed with any animal.
//
// viewBox 0 0 240 260, ground at y≈246, character centred on x=120.

import type { ReactNode } from "react";
import type { AnimalId } from "@/music/types";
import { ANIMALS } from "@/music/instruments";
import { BLUSH, L, PENCIL, S, ellipsePath, hash, mix, tint } from "./sketch";
import type { Pt } from "./affine";
import type { EarKind, TailKind } from "./motion";

export const ANCHOR = {
  ground: 246,
  shoulderL: { x: 91, y: 170 },
  shoulderR: { x: 149, y: 170 },
  /** Rotation pivot for the head (the neck). */
  neck: { x: 120, y: 158 },
  mouth: { x: 120, y: 132 },
  footL: { x: 101, y: 240 },
  footR: { x: 139, y: 240 },
  hipL: { x: 104, y: 222 },
  hipR: { x: 136, y: 222 },
};

export interface FaceSpec {
  eyes: [Pt, Pt];
  eyeR: number;
  /** Eye whites / rings drawn behind pupils. */
  sclera?: number;
  mouth: Pt;
  mouthStyle: "smile" | "wide" | "w" | "none";
  blush: [Pt, Pt];
}

/** A part that swings about a pivot: an ear (drawn behind the head) or a tail (behind the body). */
export interface Swinger<K> {
  node: ReactNode;
  pivot: Pt;
  kind: K;
}

export interface AnimalArt {
  back: ReactNode; // behind body
  body: ReactNode; // torso + feet
  head: ReactNode; // head shape, muzzle (not ears, eyes or mouth)
  /** Viewer-left and viewer-right ears, drawn behind the head. */
  ears?: [Swinger<EarKind>, Swinger<EarKind>];
  tail?: Swinger<TailKind>;
  front?: ReactNode; // drawn over eyes (beaks, noses, trunks)
  face: FaceSpec;
  /** Foot color (feet are drawn by the sprite so they can tap). */
  feet?: string;
  /** Paw/hand color when it differs from the body (hooves, mittens). */
  paw?: string;
}

const sd = (a: string, part: string) => hash(a + ":" + part);

/**
 * A puffy cloud outline: `bumps` outward arcs around an ellipse. Rough.js turns it
 * into a wobbly crayon scallop — wool, smoke, clouds.
 */
export function scallopPath(cx: number, cy: number, rx: number, ry: number, bumps: number, puff = 0.22, start = -Math.PI / 2): string {
  const pt = (a: number, k: number) => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  const step = (Math.PI * 2) / bumps;
  const [x0, y0] = pt(start, 1);
  let d = `M${x0.toFixed(1)},${y0.toFixed(1)}`;
  for (let i = 0; i < bumps; i++) {
    const a0 = start + i * step;
    const a1 = a0 + step;
    // two control points so each bump is a round lobe, not a pointy arch
    const [c1x, c1y] = pt(a0 + step * 0.12, 1 + puff * 1.15);
    const [c2x, c2y] = pt(a1 - step * 0.12, 1 + puff * 1.15);
    const [x1, y1] = pt(a1, 1);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d + " Z";
}

/** Little wool curls ("e" loops) scattered at the given points. */
function curls(points: [number, number][], r = 3.4): string {
  return points
    .map(([x, y], i) => {
      const k = i % 2 ? 1 : -1;
      return `M${x - r},${y + r * 0.2} a${r},${r} 0 1,1 ${r * 1.6},${r * 0.9 * k}`;
    })
    .join(" ");
}

function bodyAndFeet(a: AnimalId, ink: string, fill: string, belly: string): ReactNode {
  return (
    <>
      <S d={ellipsePath(120, 199, 45, 44)} ink={ink} base={tint(fill, 0.35)} hatch={fill} seed={sd(a, "body")} />
      <S d={ellipsePath(120, 206, 27, 29)} ink={mix(ink, fill, 0.4)} base={belly} hatch={mix(belly, fill, 0.35)} seed={sd(a, "belly")} gap={4.2} w={1.6} />
    </>
  );
}

function bear(): AnimalArt {
  const a: AnimalId = "bear";
  const { ink, fill } = ANIMALS[a];
  const inner = "#eec49a";
  return {
    back: null,
    body: bodyAndFeet(a, ink, fill, "#f0d6b4"),
    ears: [
      {
        node: (
          <>
            <S d={ellipsePath(79, 68, 18, 17)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "el")} />
            <S d={ellipsePath(80, 69, 9, 8)} ink={ink} base={inner} seed={sd(a, "eli")} w={1.2} />
          </>
        ),
        pivot: { x: 88, y: 80 },
        kind: "stiff",
      },
      {
        node: (
          <>
            <S d={ellipsePath(161, 68, 18, 17)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "er")} />
            <S d={ellipsePath(160, 69, 9, 8)} ink={ink} base={inner} seed={sd(a, "eri")} w={1.2} />
          </>
        ),
        pivot: { x: 152, y: 80 },
        kind: "stiff",
      },
    ],
    head: (
      <>
        <S d={ellipsePath(120, 110, 55, 49)} ink={ink} base={tint(fill, 0.35)} hatch={fill} seed={sd(a, "head")} />
        <S d={ellipsePath(120, 129, 22, 16)} ink={ink} base="#f3dcbd" hatch="#e2bb8f" seed={sd(a, "muz")} gap={4} w={1.5} />
      </>
    ),
    front: <S d={ellipsePath(120, 121, 7, 5)} ink={PENCIL} base={PENCIL} seed={sd(a, "nose")} w={1.4} />,
    face: { eyes: [{ x: 100, y: 104 }, { x: 140, y: 104 }], eyeR: 5.5, mouth: { x: 120, y: 133 }, mouthStyle: "w", blush: [{ x: 86, y: 124 }, { x: 154, y: 124 }] },
  };
}

function frog(): AnimalArt {
  const a: AnimalId = "frog";
  const { ink, fill } = ANIMALS[a];
  return {
    back: null,
    body: bodyAndFeet(a, ink, fill, "#e6efb6"),
    head: (
      <>
        <S d={ellipsePath(90, 78, 21, 20)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "bl")} />
        <S d={ellipsePath(150, 78, 21, 20)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "br")} />
        <S d={ellipsePath(120, 117, 60, 42)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "head")} />
        <S d={ellipsePath(90, 77, 12, 12)} ink={ink} base="#fffdf4" seed={sd(a, "wl")} w={1.4} />
        <S d={ellipsePath(150, 77, 12, 12)} ink={ink} base="#fffdf4" seed={sd(a, "wr")} w={1.4} />
        <L d="M106 108 q2 -2 4 0 M130 108 q2 -2 4 0" ink={ink} seed={sd(a, "nost")} w={1.4} />
      </>
    ),
    face: { eyes: [{ x: 91, y: 78 }, { x: 149, y: 78 }], eyeR: 6, mouth: { x: 120, y: 130 }, mouthStyle: "wide", blush: [{ x: 82, y: 124 }, { x: 158, y: 124 }] },
  };
}

function owl(): AnimalArt {
  const a: AnimalId = "owl";
  const { ink, fill } = ANIMALS[a];
  const belly = "#d9d2f2";
  return {
    back: null,
    body: (
      <>
        {bodyAndFeet(a, ink, fill, belly)}
        <L d="M108 194 l4 4 l4 -4 M124 194 l4 4 l4 -4 M116 207 l4 4 l4 -4 M108 220 l4 4 l4 -4 M124 220 l4 4 l4 -4" ink={mix(ink, fill, 0.35)} seed={sd(a, "scal")} w={1.2} />
      </>
    ),
    ears: [
      { node: <S d="M70 92 L66 50 L100 72 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "tl")} />, pivot: { x: 84, y: 84 }, kind: "stiff" },
      { node: <S d="M170 92 L174 50 L140 72 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "tr")} />, pivot: { x: 156, y: 84 }, kind: "stiff" },
    ],
    head: (
      <>
        <S d={ellipsePath(120, 110, 55, 50)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "head")} />
        <S d={ellipsePath(99, 106, 16, 16)} ink={ink} base="#fffdf4" hatch="#e9e4f7" seed={sd(a, "rl")} gap={5} w={1.5} />
        <S d={ellipsePath(141, 106, 16, 16)} ink={ink} base="#fffdf4" hatch="#e9e4f7" seed={sd(a, "rr")} gap={5} w={1.5} />
        {/* the little star from the reference doodles */}
        <S d="M120 50 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 Z" ink="#c98a1c" base="#f5c84c" seed={sd(a, "star")} w={1.2} />
      </>
    ),
    front: <S d="M113 119 L127 119 L120 132 Z" ink="#a4661a" base="#f0b549" seed={sd(a, "beak")} w={1.4} />,
    feet: "#e2a93b",
    face: { eyes: [{ x: 99, y: 106 }, { x: 141, y: 106 }], eyeR: 7, mouth: { x: 120, y: 132 }, mouthStyle: "none", blush: [{ x: 82, y: 128 }, { x: 158, y: 128 }] },
  };
}

function fox(): AnimalArt {
  const a: AnimalId = "fox";
  const { ink, fill } = ANIMALS[a];
  const white = "#fbf3e4";
  return {
    back: null,
    tail: {
      node: (
        <>
          <S d="M92 228 C60 236 30 214 36 180 C40 158 58 150 66 156 C60 176 70 204 100 214 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "tail")} />
          <S d="M36 180 C40 158 58 150 66 156 C62 166 60 174 62 182 C52 186 42 186 36 180 Z" ink={ink} base={white} seed={sd(a, "tip")} w={1.5} />
        </>
      ),
      pivot: { x: 98, y: 222 },
      kind: "bushy",
    },
    body: bodyAndFeet(a, ink, fill, white),
    feet: "#7a3a18",
    ears: [
      {
        node: (
          <>
            <S d="M70 92 L76 40 L108 70 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "el")} />
            <S d="M76 44 L80 60 L88 56 Z" ink={PENCIL} base="#4a2a1a" seed={sd(a, "elt")} w={1} />
          </>
        ),
        pivot: { x: 89, y: 81 },
        kind: "stiff",
      },
      {
        node: (
          <>
            <S d="M170 92 L164 40 L132 70 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "er")} />
            <S d="M164 44 L160 60 L152 56 Z" ink={PENCIL} base="#4a2a1a" seed={sd(a, "ert")} w={1} />
          </>
        ),
        pivot: { x: 151, y: 81 },
        kind: "stiff",
      },
    ],
    head: (
      <>
        <S d={ellipsePath(120, 110, 55, 47)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "head")} />
        <S d="M68 112 Q90 156 120 150 Q150 156 172 112 Q148 128 120 122 Q92 128 68 112 Z" ink={mix(ink, white, 0.3)} base={white} seed={sd(a, "mask")} w={1.4} />
      </>
    ),
    front: <S d={ellipsePath(120, 126, 6, 4.5)} ink={PENCIL} base={PENCIL} seed={sd(a, "nose")} w={1.2} />,
    face: { eyes: [{ x: 100, y: 106 }, { x: 140, y: 106 }], eyeR: 5.5, mouth: { x: 120, y: 136 }, mouthStyle: "w", blush: [{ x: 84, y: 124 }, { x: 156, y: 124 }] },
  };
}

function cat(): AnimalArt {
  const a: AnimalId = "cat";
  const { ink, fill } = ANIMALS[a];
  return {
    back: null,
    tail: {
      node: <S d="M150 226 C180 228 196 206 188 182 C184 170 194 160 202 168 C196 172 196 180 200 190 C206 214 186 238 150 236 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "tail")} />,
      pivot: { x: 152, y: 231 },
      kind: "curl",
    },
    body: bodyAndFeet(a, ink, fill, "#eef0f4"),
    ears: [
      {
        node: (
          <>
            <S d="M72 94 L78 44 L110 72 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "el")} />
            <S d="M80 54 L84 74 L98 70 Z" ink={ink} base="#f4c4cf" seed={sd(a, "eli")} w={1} />
          </>
        ),
        pivot: { x: 91, y: 83 },
        kind: "stiff",
      },
      {
        node: (
          <>
            <S d="M168 94 L162 44 L130 72 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "er")} />
            <S d="M160 54 L156 74 L142 70 Z" ink={ink} base="#f4c4cf" seed={sd(a, "eri")} w={1} />
          </>
        ),
        pivot: { x: 149, y: 83 },
        kind: "stiff",
      },
    ],
    head: (
      <>
        <S d={ellipsePath(120, 112, 55, 46)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "head")} />
        <L d="M112 72 l2 10 M120 70 l0 11 M128 72 l-2 10" ink={ink} seed={sd(a, "stripe")} w={2} />
        <L d="M80 124 l-22 -4 M80 129 l-22 2 M160 124 l22 -4 M160 129 l22 2" ink={ink} seed={sd(a, "wh")} w={1.1} />
      </>
    ),
    front: <S d="M115 122 L125 122 L120 128 Z" ink="#b0546f" base="#f08c9a" seed={sd(a, "nose")} w={1.1} />,
    face: { eyes: [{ x: 100, y: 107 }, { x: 140, y: 107 }], eyeR: 5.5, mouth: { x: 120, y: 133 }, mouthStyle: "w", blush: [{ x: 88, y: 122 }, { x: 152, y: 122 }] },
  };
}

function bunny(): AnimalArt {
  const a: AnimalId = "bunny";
  const { ink, fill } = ANIMALS[a];
  const inner = "#f39fb4";
  return {
    back: null,
    body: bodyAndFeet(a, ink, fill, "#fff3f5"),
    ears: [
      {
        node: (
          <g transform="rotate(-9 100 78)">
            <S d={ellipsePath(100, 42, 14, 40)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "el")} />
            <S d={ellipsePath(100, 46, 6, 28)} ink={ink} base={inner} seed={sd(a, "eli")} w={1} />
          </g>
        ),
        pivot: { x: 101, y: 80 },
        kind: "floppy",
      },
      {
        node: (
          <g transform="rotate(9 140 78)">
            <S d={ellipsePath(140, 42, 14, 40)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "er")} />
            <S d={ellipsePath(140, 46, 6, 28)} ink={ink} base={inner} seed={sd(a, "eri")} w={1} />
          </g>
        ),
        pivot: { x: 139, y: 80 },
        kind: "floppy",
      },
    ],
    head: (
      <>
        <S d={ellipsePath(120, 114, 52, 45)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "head")} />
      </>
    ),
    front: (
      <>
        <S d={ellipsePath(120, 124, 5, 3.5)} ink="#b0546f" base="#e86f8c" seed={sd(a, "nose")} w={1} />
        <S d="M116 136 h8 v6 h-8 Z" ink={ink} base="#fffdf4" seed={sd(a, "teeth")} w={1} />
      </>
    ),
    face: { eyes: [{ x: 101, y: 108 }, { x: 139, y: 108 }], eyeR: 5.5, mouth: { x: 120, y: 132 }, mouthStyle: "w", blush: [{ x: 88, y: 124 }, { x: 152, y: 124 }] },
  };
}

function elephant(): AnimalArt {
  const a: AnimalId = "elephant";
  const { ink, fill } = ANIMALS[a];
  return {
    back: null,
    body: bodyAndFeet(a, ink, fill, "#dbe7ee"),
    ears: [
      {
        node: (
          <>
            <S d={ellipsePath(66, 110, 30, 38)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "el")} />
            <S d={ellipsePath(68, 112, 18, 25)} ink={ink} base="#f4c4cf" seed={sd(a, "eli")} w={1} />
          </>
        ),
        pivot: { x: 90, y: 104 },
        kind: "flap",
      },
      {
        node: (
          <>
            <S d={ellipsePath(174, 110, 30, 38)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "er")} />
            <S d={ellipsePath(172, 112, 18, 25)} ink={ink} base="#f4c4cf" seed={sd(a, "eri")} w={1} />
          </>
        ),
        pivot: { x: 150, y: 104 },
        kind: "flap",
      },
    ],
    head: (
      <>
        <S d={ellipsePath(120, 108, 49, 47)} ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "head")} />
      </>
    ),
    front: (
      <>
        <S d="M104 136 q-6 8 -2 12" ink={ink} base="#fffdf4" seed={sd(a, "tl")} w={1.2} />
        <S d="M136 136 q6 8 2 12" ink={ink} base="#fffdf4" seed={sd(a, "tr")} w={1.2} />
        <S d="M110 116 C108 136 102 148 88 150 C80 151 79 143 85 142 C94 141 112 138 130 116 Z" ink={ink} base={tint(fill, 0.3)} hatch={fill} seed={sd(a, "trunk")} />
        <L d="M106 128 q4 2 8 0 M101 138 q4 2 8 0" ink={ink} seed={sd(a, "tw")} w={1.1} />
      </>
    ),
    face: { eyes: [{ x: 102, y: 104 }, { x: 138, y: 104 }], eyeR: 5, mouth: { x: 120, y: 134 }, mouthStyle: "none", blush: [{ x: 90, y: 124 }, { x: 150, y: 124 }] },
  };
}

function penguin(): AnimalArt {
  const a: AnimalId = "penguin";
  const { ink, fill } = ANIMALS[a];
  const white = "#fbf8ef";
  return {
    back: null,
    body: bodyAndFeet(a, ink, fill, white),
    feet: "#e8963a",
    head: (
      <>
        <S d={ellipsePath(120, 110, 52, 48)} ink={ink} base={tint(fill, 0.2)} hatch={fill} seed={sd(a, "head")} />
        <S d="M120 96 C108 80 80 86 80 112 C80 136 104 146 120 144 C136 146 160 136 160 112 C160 86 132 80 120 96 Z" ink={mix(ink, white, 0.4)} base={white} seed={sd(a, "mask")} w={1.4} />
      </>
    ),
    front: <S d="M112 122 L128 122 L120 132 Z" ink="#a4561a" base="#f0a13a" seed={sd(a, "beak")} w={1.3} />,
    face: { eyes: [{ x: 103, y: 110 }, { x: 137, y: 110 }], eyeR: 5.5, mouth: { x: 120, y: 132 }, mouthStyle: "none", blush: [{ x: 92, y: 126 }, { x: 148, y: 126 }] },
  };
}

function sheep(): AnimalArt {
  const a: AnimalId = "sheep";
  const { ink } = ANIMALS[a];
  const wool = "#f6eedd";
  const woolHatch = "#e3d3b0";
  const face = "#a68b72";
  const faceHatch = "#8a6f58";
  const inner = "#e7a9a6";
  return {
    back: null,
    tail: { node: <S d={scallopPath(166, 212, 11, 10, 6, 0.3)} ink={ink} base={wool} hatch={woolHatch} seed={sd(a, "tail")} gap={3.2} w={1.6} />, pivot: { x: 157, y: 215 }, kind: "puff" },
    body: (
      <>
        <S d={scallopPath(120, 200, 43, 41, 13, 0.16)} ink={ink} base={wool} hatch={woolHatch} seed={sd(a, "body")} gap={3.6} />
        <L d={curls([[100, 186], [138, 182], [118, 204], [96, 218], [142, 214], [121, 228], [108, 170], [134, 166]])} ink={mix(ink, wool, 0.45)} seed={sd(a, "bcurl")} w={1.3} />
      </>
    ),
    // floppy ears poke out sideways from under the wool
    ears: [
      {
        node: (
          <g transform="rotate(16 68 108)">
            <S d={ellipsePath(62, 108, 22, 9)} ink={ink} base={face} hatch={faceHatch} seed={sd(a, "el")} gap={2.8} />
            <S d={ellipsePath(60, 108, 13, 4.2)} ink={mix(ink, inner, 0.5)} base={inner} seed={sd(a, "eli")} w={1} />
          </g>
        ),
        pivot: { x: 82, y: 104 },
        kind: "floppy",
      },
      {
        node: (
          <g transform="rotate(-16 172 108)">
            <S d={ellipsePath(178, 108, 22, 9)} ink={ink} base={face} hatch={faceHatch} seed={sd(a, "er")} gap={2.8} />
            <S d={ellipsePath(180, 108, 13, 4.2)} ink={mix(ink, inner, 0.5)} base={inner} seed={sd(a, "eri")} w={1} />
          </g>
        ),
        pivot: { x: 158, y: 104 },
        kind: "floppy",
      },
    ],
    head: (
      <>
        {/* wool cap behind the face */}
        <S d={scallopPath(120, 100, 52, 44, 12, 0.2)} ink={ink} base={wool} hatch={woolHatch} seed={sd(a, "wool")} gap={3.6} />
        <L d={curls([[84, 82], [158, 84], [80, 112], [162, 114], [102, 66], [140, 66]], 3)} ink={mix(ink, wool, 0.45)} seed={sd(a, "hcurl")} w={1.2} />
        {/* the face: a soft taupe egg */}
        <S d="M120 84 C96 84 86 102 88 122 C90 144 104 156 120 156 C136 156 150 144 152 122 C154 102 144 84 120 84 Z" ink={ink} base={mix(face, "#fff", 0.25)} hatch={face} seed={sd(a, "face")} gap={3.4} />
        {/* forehead tuft */}
        <S d={scallopPath(120, 84, 21, 10, 5, 0.42, Math.PI)} ink={ink} base={wool} hatch={woolHatch} seed={sd(a, "tuft")} gap={3.2} w={1.7} />
        <S d={ellipsePath(120, 137, 14, 10)} ink={mix(ink, face, 0.35)} base={mix(face, "#fff", 0.45)} seed={sd(a, "muz")} w={1.3} />
      </>
    ),
    front: <L d="M115 130 q5 4 10 0 M120 132 v4" ink={PENCIL} seed={sd(a, "nose")} w={1.8} />,
    feet: "#4a3a2e",
    paw: "#5a4636",
    face: { eyes: [{ x: 105, y: 115 }, { x: 135, y: 115 }], eyeR: 5.2, mouth: { x: 120, y: 141 }, mouthStyle: "w", blush: [{ x: 99, y: 132 }, { x: 141, y: 132 }] },
  };
}

const BUILDERS: Record<AnimalId, () => AnimalArt> = { bear, frog, owl, fox, cat, bunny, elephant, penguin, sheep };
const artCache = new Map<AnimalId, AnimalArt>();

export function animalArt(a: AnimalId): AnimalArt {
  let v = artCache.get(a);
  if (!v) {
    v = BUILDERS[a]();
    artCache.set(a, v);
  }
  return v;
}

/** Blush patches: hatched pink, like a crayon scribble. */
export function Blush({ at, seed }: { at: Pt; seed: number }) {
  return <S d={ellipsePath(at.x, at.y, 9, 5.5)} ink={BLUSH} hatch={BLUSH} noStroke seed={seed} gap={2.2} angle={-30} hatchW={1.6} />;
}

export function mouthPath(style: FaceSpec["mouthStyle"], m: Pt): string | null {
  switch (style) {
    case "smile":
      return `M${m.x - 6} ${m.y} Q${m.x} ${m.y + 6} ${m.x + 6} ${m.y}`;
    case "wide":
      return `M${m.x - 22} ${m.y - 3} Q${m.x} ${m.y + 10} ${m.x + 22} ${m.y - 3}`;
    case "w":
      return `M${m.x - 8} ${m.y - 2} Q${m.x - 4} ${m.y + 4} ${m.x} ${m.y - 1} Q${m.x + 4} ${m.y + 4} ${m.x + 8} ${m.y - 2}`;
    default:
      return null;
  }
}

export { tint, mix };
