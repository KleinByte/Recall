import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoots = [
  ".github/",
  "docker/",
  "electron/",
  "scripts/",
  "src/",
  "tests/",
  "website/",
]
const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".sh",
  ".svg",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
])
const rootConfiguration = new Set([
  ".dockerignore",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".node-version",
  ".npmrc",
  "README.md",
  "compose.league.yaml",
  "compose.yaml",
  "Dockerfile.dev",
  "electron-builder.azure.cjs",
  "electron-builder.json",
  "index.html",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vitest.config.ts",
])
const activeRuntimeRoots = ["electron/", "scripts/", "src/"]
const retainedCompatibilityMarkers = [
  {
    file: "electron/main/matches/match-grade-recipe.ts",
    marker: "recall.grade.v3.radar-arms.2026-08-10.r2",
    reason: "recognizes the exact immutable Grade identity from existing installations",
  },
  {
    file: "electron/main/matches/match-grade-recipe.ts",
    marker: "recall.grade.v3.evidence.2026-08-10.r2",
    reason: "validates the exact evidence contract attached to the legacy identity",
  },
  {
    file: "electron/main/matches/match-grade-recipe.ts",
    marker: "recall.grade.v3.calibration.",
    reason: "recognizes and normalizes opaque historical calibration foreign keys",
  },
  {
    file: "electron/main/matches/rvi-recipe.ts",
    marker: "recall.rvi.v3.detail-definition.2026-08-10.r2",
    reason: "maps renamed recipe identity to its frozen bootstrap seed",
  },
  {
    file: "electron/main/matches/rvi-recipe.ts",
    marker: "recall.grade.v3.calibration.",
    reason: "maps renamed calibration identity to its frozen bootstrap seed",
  },
  {
    file: "electron/main/matches/rvi-recipe.ts",
    marker: "recall.rvi.v3.metric-registry.2026-08-10.r2",
    reason: "validates the exact immutable metric registry stored by existing installations",
  },
  {
    file: "electron/main/matches/rvi-recipe.ts",
    marker: "recall.rvi.v3.timeline.12s-1200u.2026-08-10.r2",
    reason: "validates the exact immutable timeline policy stored by existing installations",
  },
  {
    file: "electron/main/matches/rvi-recipe.ts",
    marker: "recall.rvi.v3.seven-match-arms.profile-range.2026-08-10.r2",
    reason: "validates the exact immutable vector policy stored by existing installations",
  },
  {
    file: "electron/main/review/recommendations.ts",
    marker: "recommendation:v3",
    reason: "frozen deterministic recommendation seed",
  },
  {
    file: "electron/main/matches/statistical-contract.ts",
    marker: "condition:v3",
    reason: "frozen deterministic statistical seed",
  },
]

function walk(relativeRoot) {
  const absoluteRoot = path.join(repositoryRoot, relativeRoot)
  if (!existsSync(absoluteRoot)) return []

  return readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeRoot, entry.name)
    return entry.isDirectory() ? walk(relative) : [relative]
  })
}

function repositoryFiles() {
  try {
    return {
      fromGit: true,
      files: execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      )
        .split("\0")
        .filter(Boolean)
        .map((file) => file.replaceAll("\\", "/")),
    }
  } catch {
    // Release source archives and Docker contexts intentionally omit .git.
    // Formatting and safety checks must still work in those environments.
    return {
      fromGit: false,
      files: [
        ...rootConfiguration,
        ...sourceRoots.flatMap(walk),
        ...walk("docs/screenshots"),
      ],
    }
  }
}

function isSourceOrConfiguration(file) {
  if (rootConfiguration.has(file)) return true
  if (!sourceRoots.some((root) => file.startsWith(root))) return false
  return sourceExtensions.has(path.posix.extname(file))
}

function localMarkdownImages(markdown) {
  const targets = []
  const pattern = /!\[[^\]]*\]\(([^)]+)\)/g
  for (const match of markdown.matchAll(pattern)) {
    const target = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0]
    if (!/^(?:[a-z]+:|#)/i.test(target)) targets.push(decodeURI(target))
  }
  return targets
}

function reachableRendererFiles(files) {
  const rendererFiles = new Set(files.filter((file) => file.startsWith("src/")))
  const reachable = new Set()
  const pending = ["src/main.ts"]
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g

  const resolveImport = (importer, specifier) => {
    if (!specifier.startsWith(".")) return undefined
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.vue`,
      `${base}/index.ts`,
      ...(base.endsWith(".js") ? [base.slice(0, -3) + ".ts"] : []),
    ]
    return candidates.find((candidate) => rendererFiles.has(candidate))
  }

  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || reachable.has(file) || !rendererFiles.has(file)) continue
    reachable.add(file)
    const content = readFileSync(path.join(repositoryRoot, file), "utf8")
    for (const match of content.matchAll(importPattern)) {
      const dependency = resolveImport(file, match[1])
      if (dependency && !reachable.has(dependency)) pending.push(dependency)
    }
  }

  return reachable
}

const repository = repositoryFiles()
const files = [...new Set(repository.files)]
  .filter((file) => existsSync(path.join(repositoryRoot, file)))
const eligibleFiles = new Set(files)
const errors = []
const attributes = readFileSync(path.join(repositoryRoot, ".gitattributes"), "utf8")

const reachableRenderer = reachableRendererFiles(files)
for (const component of files.filter((file) =>
  file.startsWith("src/components/") && file.endsWith(".vue"))) {
  if (!reachableRenderer.has(component)) {
    errors.push(`${component} is unreachable from the renderer entry point`)
  }
}

const versionNamePattern = /recall\.(?:grade|rvi)\.v\d+|\b(?:MATCH_GRADE|RVI)_ALGORITHM_VERSION\b|\bSKILL_REPORT_VERSION\b|grade_v\d+|:v\d+:/g
for (const file of files.filter((candidate) =>
  activeRuntimeRoots.some((root) => candidate.startsWith(root)) &&
  candidate !== "electron/main/database/migrations.ts" &&
  candidate !== "scripts/check-repository-hygiene.mjs" &&
  sourceExtensions.has(path.posix.extname(candidate)))) {
  let content = readFileSync(path.join(repositoryRoot, file), "utf8")
  for (const allowed of retainedCompatibilityMarkers.filter((entry) => entry.file === file)) {
    content = content.replaceAll(allowed.marker, "")
  }
  for (const match of content.matchAll(versionNamePattern)) {
    errors.push(`${file} contains retired active Grade/RVI version name: ${match[0]}`)
  }
}

for (const entry of retainedCompatibilityMarkers) {
  const absolutePath = path.join(repositoryRoot, entry.file)
  if (!existsSync(absolutePath) || !readFileSync(absolutePath, "utf8").includes(entry.marker)) {
    errors.push(
      `${entry.file} no longer contains ${entry.marker}; remove its hygiene allowlist entry (${entry.reason})`,
    )
  }
}

for (const extension of sourceExtensions) {
  if (!attributes.includes(`*${extension} text eol=lf`)) {
    errors.push(`.gitattributes does not pin ${extension} files to LF`)
  }
}
for (const file of [
  ".dockerignore",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".node-version",
  ".npmrc",
]) {
  if (!attributes.includes(`${file} text eol=lf`)) {
    errors.push(`.gitattributes does not pin ${file} to LF`)
  }
}

for (const file of files.filter(isSourceOrConfiguration)) {
  const absolutePath = path.join(repositoryRoot, file)
  const content = readFileSync(absolutePath, "utf8")
  if (content.includes("\0")) errors.push(`${file} contains a NUL byte`)
  if (content.startsWith("\uFEFF")) errors.push(`${file} contains a UTF-8 BOM`)
  if (content.length > 0 && !content.endsWith("\n")) {
    errors.push(`${file} is missing a final newline`)
  }
  content.split(/\r?\n/).forEach((line, index) => {
    if (/^(?:<{7}|>{7})(?: |$)/.test(line)) {
      errors.push(`${file}:${index + 1} contains an unresolved merge marker`)
    }
    if (path.posix.extname(file) !== ".md" && /[ \t]+$/.test(line)) {
      errors.push(`${file}:${index + 1} contains trailing whitespace`)
    }
    if (/^\t/.test(line) && path.posix.basename(file) !== "Makefile") {
      errors.push(`${file}:${index + 1} uses a leading tab instead of spaces`)
    }
  })

  if (path.posix.extname(file) === ".json") {
    try {
      JSON.parse(content)
    } catch (error) {
      errors.push(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

const readme = readFileSync(path.join(repositoryRoot, "README.md"), "utf8")
for (const target of localMarkdownImages(readme)) {
  const normalized = path.posix.normalize(target.replaceAll("\\", "/"))
  if (!existsSync(path.join(repositoryRoot, normalized))) {
    errors.push(`README.md references missing image: ${target}`)
  } else if (repository.fromGit && !eligibleFiles.has(normalized)) {
    errors.push(`README.md image is ignored and will be missing from GitHub: ${target}`)
  }
}

if (existsSync(path.join(repositoryRoot, "vite.config.flat.txt"))) {
  errors.push("vite.config.flat.txt is obsolete; use vite.config.ts")
}

if (errors.length > 0) {
  console.error(`Repository hygiene check failed:\n- ${errors.join("\n- ")}`)
  process.exitCode = 1
} else {
  const source = repository.fromGit ? "Git index" : "filesystem fallback"
  console.log(
    `Repository hygiene check passed (${files.filter(isSourceOrConfiguration).length} files checked from ${source}).`,
  )
}
