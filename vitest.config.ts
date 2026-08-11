import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"

// The application's Vite config polyfills Node built-ins for the renderer.
// Main-process tests need the real modules, so they use a dedicated config.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
