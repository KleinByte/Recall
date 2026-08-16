import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"

// Tests exercise main-process Node modules directly and do not need the
// Electron application-build plugins, so they use a dedicated config.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
})
