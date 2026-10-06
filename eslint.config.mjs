import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The music engine is deterministic: same settings and seed, same take. Share links replay
  // takes from just that, so randomness and the clock go through Rng (src/music/rng.ts).
  // performance.now() is fine: it only times the engine, it never changes what it plays.
  {
    files: ["src/music/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded Rng from ./rng so a seed always gives the same take." },
        { object: "Date", property: "now", message: "The music can't depend on the clock; use the seeded Rng from ./rng." },
        { object: "crypto", property: "getRandomValues", message: "Use the seeded Rng from ./rng." },
        { object: "crypto", property: "randomUUID", message: "Use the seeded Rng from ./rng." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "The music can't depend on the clock; use the seeded Rng from ./rng." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
