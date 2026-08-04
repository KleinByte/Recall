import { defineConfig } from "vitest/config"

// The application's Vite config polyfills Node built-ins for the renderer.
// Main-process tests need the real modules, so they use a dedicated config.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
