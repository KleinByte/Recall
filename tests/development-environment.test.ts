import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")
const packageJson = JSON.parse(read("package.json")) as {
  packageManager: string
  engines: { node: string; pnpm: string }
  pnpm?: { onlyBuiltDependencies?: string[] }
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const [packageManagerName, pnpmVersion] = packageJson.packageManager.split("@")
const nodeVersion = packageJson.engines.node

describe("development environment contract", () => {
  it("uses one exact Node and pnpm toolchain everywhere", () => {
    expect(packageManagerName).toBe("pnpm")
    expect(pnpmVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageJson.engines.pnpm).toBe(pnpmVersion)
    expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(read(".node-version").trim()).toBe(nodeVersion)

    const dockerfile = read("Dockerfile.dev")
    expect(dockerfile).toContain(`FROM node:${nodeVersion}-bookworm`)
    expect(dockerfile).toContain(`corepack prepare pnpm@${pnpmVersion} --activate`)

    for (const workflow of [
      ".github/workflows/release.yml",
      ".github/workflows/verify.yml",
    ]) {
      const source = read(workflow)
      expect(source).toContain(`node-version: ${nodeVersion}`)
      expect(source).toContain(`version: ${pnpmVersion}`)
      expect(source).toContain("pnpm install --frozen-lockfile")
    }

    const readme = read("README.md")
    expect(readme).toContain(`Node.js ${nodeVersion}`)
    expect(readme).toContain(`pnpm ${pnpmVersion}`)
  })

  it("keeps native build policy compatible and both SQLite ABIs in lockstep", () => {
    expect(read(".npmrc")).toContain("package-import-method=copy")

    // pnpm 9 reads this policy from package.json; newer pnpm releases read
    // the workspace copy. Keep both until the pinned package manager changes.
    expect([...(packageJson.pnpm?.onlyBuiltDependencies ?? [])].sort())
      .toEqual(["better-sqlite3", "electron", "electron-winstaller", "esbuild"])

    const workspace = read("pnpm-workspace.yaml")
    expect(workspace).toContain("onlyBuiltDependencies:")
    expect(workspace).toContain("  - better-sqlite3")
    expect(workspace).toContain("  - electron")
    expect(workspace).toContain("  - electron-winstaller")
    expect(workspace).toContain("  - esbuild")

    expect(packageJson.scripts["rebuild:electron"])
      .toBe("electron-builder install-app-deps")
    expect(packageJson.devDependencies).not.toHaveProperty("@electron/rebuild")
    expect(read("scripts/rebuild-node-native.mjs")).not.toContain('"--force"')

    const applicationVersion = packageJson.dependencies["better-sqlite3"]
    expect(applicationVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageJson.devDependencies["better-sqlite3-node"])
      .toBe(`npm:better-sqlite3@${applicationVersion}`)
    expect(packageJson.devDependencies["node-abi"]).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("gates changes and releases through the shared verification path", () => {
    const verify = packageJson.scripts.verify
    for (const command of [
      "pnpm check:repo",
      "pnpm typecheck",
      "pnpm test",
      "pnpm build:renderer",
      "pnpm doctor:native",
    ]) {
      expect(verify).toContain(command)
    }

    expect(packageJson.scripts["verify:ci"]).toContain("pnpm verify")
    expect(packageJson.scripts["verify:ci"]).toContain("pnpm test:e2e")
    expect(packageJson.scripts["verify:ci"]).toContain("pnpm package:smoke")
    expect(packageJson.scripts.release).toContain("pnpm verify")
    expect(packageJson.scripts.release).toContain("pnpm test:e2e")
    expect(packageJson.scripts["release:signed"]).toContain("pnpm verify")
    expect(packageJson.scripts["release:signed"]).toContain("pnpm test:e2e")

    const verificationWorkflow = read(".github/workflows/verify.yml")
    expect(verificationWorkflow).toContain("pull_request:")
    expect(verificationWorkflow).toContain("branches:")
    expect(verificationWorkflow).toContain("- main")
    expect(verificationWorkflow).toContain("pnpm verify:ci")

    const releaseWorkflow = read(".github/workflows/release.yml")
    expect(releaseWorkflow).toContain("Verify tag matches the application version")
    expect(releaseWorkflow).toContain('$expectedTag = "v$version"')
  })

  it("keeps the renderer startup budget and dashboard loading boundary explicit", () => {
    expect(read("src/App.vue")).toContain(
      'defineAsyncComponent(() => import("./pages/DashboardPage.vue"))',
    )

    const vite = read("vite.config.ts")
    expect(vite).toContain("rendererEntryBudgetBytes = 250 * 1024")
    expect(vite).toContain("recall-renderer-entry-budget")
    expect(vite).toContain('return "chart-engine"')
  })
})
