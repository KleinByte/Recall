import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = path.join(repositoryRoot, "src/design/theme-colors.json")
const cssOutputPath = path.join(repositoryRoot, "src/design/theme-colors.generated.css")
const tsOutputPath = path.join(repositoryRoot, "src/design/theme-colors.generated.ts")

const palette = JSON.parse(readFileSync(sourcePath, "utf8"))

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
  return value
}

function validateCssProperties(properties, name, prefix) {
  const entries = Object.entries(assertRecord(properties, name))
  for (const [property, value] of entries) {
    if (!new RegExp(`^${prefix}[a-z0-9-]+$`).test(property)) {
      throw new TypeError(`${name}.${property} is not a supported custom-property name`)
    }
    if (typeof value !== "string" || value.length === 0 || /[;{}\n\r]/.test(value)) {
      throw new TypeError(`${name}.${property} is not a safe, non-empty CSS value`)
    }
  }
  return entries
}

function requiredString(record, key, name) {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name}.${key} must be a non-empty string`)
  }
  return value
}

const css = assertRecord(palette.css, "css")
const compatibility = assertRecord(palette.compatibility, "compatibility")
const canvas = assertRecord(palette.canvas, "canvas")
const cssEntries = validateCssProperties(css, "css", "ui-")
const compatibilityEntries = validateCssProperties(compatibility, "compatibility", "")

const uiTheme = {
  accent: requiredString(css, "ui-accent", "css"),
  accentStrong: requiredString(css, "ui-accent-strong", "css"),
  live: requiredString(css, "ui-live", "css"),
  liveDim: requiredString(canvas, "liveDim", "canvas"),
  positive: requiredString(css, "ui-positive", "css"),
  negative: requiredString(css, "ui-negative", "css"),
  text: requiredString(css, "ui-text", "css"),
  textSubtle: requiredString(css, "ui-text-subtle", "css"),
  textMuted: requiredString(canvas, "textMuted", "canvas"),
  surfaceInset: requiredString(css, "ui-surface-inset-color", "css"),
  grid: requiredString(css, "ui-divider", "css"),
  gridSoft: requiredString(canvas, "gridSoft", "canvas"),
  neutral: requiredString(canvas, "neutral", "canvas"),
  teamBlue: requiredString(css, "ui-team-blue", "css"),
  teamRed: requiredString(css, "ui-team-red", "css"),
  labelBackdrop: requiredString(canvas, "labelBackdrop", "canvas"),
  labelShadow: requiredString(canvas, "labelShadow", "canvas"),
}

if (!Array.isArray(palette.scoreRamp) || palette.scoreRamp.length < 2 ||
    palette.scoreRamp.some((value) => typeof value !== "string" || value.length === 0)) {
  throw new TypeError("scoreRamp must contain at least two non-empty color strings")
}

const cssOutput = `/*
 * Generated from theme-colors.json by scripts/generate-theme-colors.mjs.
 * Run \`pnpm theme:generate\` after changing the source palette.
 */
:root {
  /* Supported semantic application colors. */
${cssEntries.map(([property, value]) => `  --${property}: ${value};`).join("\n")}

  /* Compatibility colors for features still migrating to --ui-* roles. */
${compatibilityEntries.map(([property, value]) => `  --${property}: ${value};`).join("\n")}
}
`

const tsObject = Object.entries(uiTheme)
  .map(([role, value]) => `  ${role}: ${JSON.stringify(value)},`)
  .join("\n")
const tsRamp = palette.scoreRamp.map((value) => `  ${JSON.stringify(value)},`).join("\n")
const tsOutput = `/*
 * Generated from theme-colors.json by scripts/generate-theme-colors.mjs.
 * Run \`pnpm theme:generate\` after changing the source palette.
 */
export const GENERATED_UI_THEME = {
${tsObject}
} as const

export const GENERATED_SCORE_RAMP = [
${tsRamp}
] as const
`

const outputs = [
  [cssOutputPath, cssOutput],
  [tsOutputPath, tsOutput],
]
const checking = process.argv.includes("--check")
const stale = outputs.filter(([outputPath, expected]) => {
  try {
    return readFileSync(outputPath, "utf8") !== expected
  } catch {
    return true
  }
})

if (checking && stale.length > 0) {
  console.error(
    `Generated theme artifacts are stale: ${stale
      .map(([outputPath]) => path.relative(repositoryRoot, outputPath))
      .join(", ")}. Run \`pnpm theme:generate\`.`,
  )
  process.exitCode = 1
} else if (checking) {
  console.log("Generated theme artifacts are current.")
} else {
  for (const [outputPath, expected] of outputs) writeFileSync(outputPath, expected)
  console.log("Generated theme CSS and TypeScript artifacts.")
}
