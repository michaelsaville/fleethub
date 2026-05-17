import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

// Phase 8 Workstream C §5.5 — vitest config.
// - Alias `server-only` to an empty module so pure-function modules
//   that import it (every lib/*-validate, bff-hmac, etc.) can be
//   pulled into tests.
// - Wire the `@/` path alias to mirror tsconfig.json's baseUrl.
// - Node environment by default; no JSDOM needed for these tests.

export default defineConfig({
  resolve: {
    alias: {
      "server-only": resolve(__dirname, "tests/fixtures/server-only.ts"),
      "@/": resolve(__dirname) + "/",
      "@": resolve(__dirname),
    },
  },
  // PostCSS doesn't apply to our tests — passing an empty `postcss`
  // object stops vite from auto-discovering Next's tailwind config
  // (which crashes vite's plugin loader).
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
})
