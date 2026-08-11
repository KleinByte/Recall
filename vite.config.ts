import fs from "node:fs"
import { defineConfig, type Plugin } from "vite"
import vue from "@vitejs/plugin-vue"
import electron from "vite-plugin-electron/simple"
import pkg from "./package.json"
import { nodePolyfills } from "vite-plugin-node-polyfills"

// Pure JavaScript dependencies used by the main process are bundled so their
// transitive dependency trees cannot be pruned by the desktop packager. Keep
// only native or intentionally external runtime modules here.
const mainProcessExternals = ["better-sqlite3", "electron", "ws"]
const rendererEntryBudgetBytes = 250 * 1024

function rendererEntryBudget(): Plugin {
  return {
    name: "recall-renderer-entry-budget",
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((item) =>
        item.type === "chunk" &&
        item.isEntry &&
        item.facadeModuleId?.replaceAll("\\", "/").endsWith("/src/main.ts"))
      if (!entry || entry.type !== "chunk") return

      const bytes = Buffer.byteLength(entry.code)
      if (bytes > rendererEntryBudgetBytes) {
        this.error(
          `Renderer startup entry is ${Math.ceil(bytes / 1024)} kB; ` +
          `keep it below ${rendererEntryBudgetBytes / 1024} kB by lazy-loading feature pages.`,
        )
      }
    },
  }
}

/**
 * Keep the renderer's long-lived framework dependencies independently
 * cacheable. Page components remain Vite-managed async chunks; these groups
 * are intentionally limited to stable library boundaries so a small feature
 * edit does not produce a fragile graph of vendor micro-chunks.
 */
function rendererChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined
  if (id.includes("/zrender/")) return "chart-renderer"
  if (id.includes("/echarts/")) return "chart-engine"
  if (id.includes("/@fortawesome/")) return "icons"
  if (id.includes("/vue/") || id.includes("/@vue/")) return "vue"
  return undefined
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  fs.rmSync("dist-electron", { recursive: true, force: true })

  const isServe = command === "serve"
  const isBuild = command === "build"
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  return {
    base: isServe ? "/" : "./",
    plugins: [
      vue(),
      rendererEntryBudget(),
      nodePolyfills({
        globals: {
          Buffer: true,
        },
      }),
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: "electron/main/index.ts",
          onstart({ startup }) {
            if (process.env.VSCODE_DEBUG) {
              console.log(
                /* For `.vscode/.debug.script.mjs` */ "[startup] Electron App"
              )
            } else {
              startup()
            }
          },
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: "dist-electron/main",
              rollupOptions: {
                external: mainProcessExternals,
              },
            },
          },
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: "electron/preload/index.ts",
          vite: {
            build: {
              sourcemap: sourcemap ? "inline" : undefined, // #332
              minify: isBuild,
              outDir: "dist-electron/preload",
              rollupOptions: {
                external: ["electron"],
              },
            },
          },
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: {},
      }),
    ],
    server:
      process.env.VSCODE_DEBUG &&
      (() => {
        const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
        return {
          host: url.hostname,
          port: +url.port,
        }
      })(),
    clearScreen: false,
    build: {
      // ECharts is deliberately isolated and loaded with chart-bearing pages.
      // Its engine is larger than Vite's generic 500 kB warning threshold,
      // while the actual startup entry remains well below this budget.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: rendererChunk,
        },
      },
    },
  }
})
