import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Real-model runs against the AI Gateway (spends credits): `pnpm eval:gateway`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.eval.ts"], testTimeout: 600_000 },
});
