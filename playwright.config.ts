import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})
