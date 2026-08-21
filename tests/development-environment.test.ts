import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")
const packageJson = JSON.parse(read("package.json")) as {
  packageManager: string
  engines: { node: string; pnpm: string }
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
    expect(dockerfile).toContain(`npm install --global pnpm@${pnpmVersion}`)
    expect(dockerfile.indexOf("COPY scripts/rebuild-node-native.mjs"))
      .toBeLessThan(dockerfile.indexOf("RUN pnpm install --frozen-lockfile"))
    expect(read("docker/start-dev.sh"))
      .toContain("pnpm exec vite --host 0.0.0.0 --port 3344")

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
    const workspace = read("pnpm-workspace.yaml")
    expect(workspace).toContain("nodeLinker: hoisted")
    expect(workspace).toContain("packageImportMethod: copy")
    expect(workspace).toContain("allowBuilds:")
    expect(workspace).toContain("  better-sqlite3: true")
    expect(workspace).toContain("  electron: true")
    expect(workspace).toContain("  electron-winstaller: true")
    expect(workspace).toContain("  esbuild: true")

    expect(packageJson.scripts["rebuild:electron"])
      .toBe("electron-builder install-app-deps")

    const builder = JSON.parse(read("electron-builder.json")) as {
      asarUnpack: string[]
      files: string[]
    }
    expect(builder.asarUnpack).toEqual([
      "**/node_modules/better-sqlite3/prebuilds/win32-x64.node",
    ])
    expect(builder.files).toContain("!node_modules/better-sqlite3/build/**/*")
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
    expect(packageJson.scripts["store:package"]).toContain("pnpm verify")
    expect(packageJson.scripts["store:package"]).toContain("pnpm test:e2e")
    expect(packageJson.scripts.release).toBe("pnpm store:package")
    expect(packageJson.scripts["release:signed"]).toBe("pnpm store:package")

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
    expect(vite).toContain("rolldownOptions:")
    expect(vite).toContain("chunkSizeWarningLimit: 700")
  })
})
