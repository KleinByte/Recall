import fs from "node:fs"
import { defineConfig, type Plugin } from "vite"
import vue from "@vitejs/plugin-vue"
import electron from "vite-plugin-electron/simple"
import pkg from "./package.json" with { type: "json" }

// Pure JavaScript dependencies used by the main process are bundled so their
// transitive dependency trees cannot be pruned by the desktop packager. Keep
// only native or intentionally external runtime modules here.
const mainProcessExternals = [
  "@techstark/opencv-js",
  "better-sqlite3",
  "electron",
  "onnxruntime-node",
  "ws",
]
const rendererEntryBudgetBytes = 250 * 1024
const minimapTrainingGlob = "**/.minimap-training/**"

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
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: {
            index: "electron/main/index.ts",
            "analysis-worker": "electron/main/background/analysis-worker.ts",
            "vision-worker": "electron/main/vision/vision-worker.ts",
          },
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
              watch: isServe ? { exclude: minimapTrainingGlob } : null,
              rolldownOptions: {
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
              watch: isServe ? { exclude: minimapTrainingGlob } : null,
              rolldownOptions: {
                external: ["electron"],
              },
            },
          },
        },
        // Keep the plugin's Electron renderer bridge, but do not inject general
        // Node globals: the sandboxed renderer uses the preload API exclusively.
        renderer: {},
      }),
    ],
    server: {
      watch: {
        ignored: [minimapTrainingGlob],
      },
      ...(process.env.VSCODE_DEBUG
        ? (() => {
            const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
            return {
              host: url.hostname,
              port: +url.port,
            }
          })()
        : {}),
    },
    clearScreen: false,
    build: {
      // ECharts is loaded only with chart-bearing pages. Rolldown's default
      // chunk graph preserves the package's internal execution order; the
      // startup entry remains independently enforced by the budget plugin.
      chunkSizeWarningLimit: 700,
    },
  }
})
