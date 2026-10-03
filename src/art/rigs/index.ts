import type { InstrumentId } from "@/music/types";
import type { Rig } from "./types";
import { piano } from "./piano";
import { drums } from "./drums";
import { vibes } from "./vibes";
import { clarinetRig, flute, sax, trombone, trumpet } from "./horns";
import { bass, cello, guitar, violin } from "./strings";

export const RIGS: Record<InstrumentId, Rig> = {
  piano,
  drums,
  vibes,
  trumpet,
  trombone,
  sax,
  clarinet: clarinetRig,
  flute,
  violin,
  cello,
  bass,
  guitar,
};
