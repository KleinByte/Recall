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

const repository = repositoryFiles()
const files = [...new Set(repository.files)]
  .filter((file) => existsSync(path.join(repositoryRoot, file)))
const eligibleFiles = new Set(files)
const errors = []
const attributes = readFileSync(path.join(repositoryRoot, ".gitattributes"), "utf8")

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
