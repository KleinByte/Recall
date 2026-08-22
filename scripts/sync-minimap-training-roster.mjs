/**
 * Snapshots the locally bundled Data Dragon portrait roster for minimap model
 * training. This script never contacts Riot or Hugging Face; run
 * `pnpm sync:champion-portraits` separately when intentionally updating assets.
 */

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const portraitManifestPath = resolve(repositoryRoot, "resources/champion-portraits/manifest.json")
const modelDirectory = resolve(repositoryRoot, "resources/minimap-model")
const rosterPath = resolve(repositoryRoot, "minimap_training/roster.json")

const argumentsSet = new Set(process.argv.slice(2))
const update = argumentsSet.has("--update")
const check = argumentsSet.has("--check") || !update

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function normalize(value) {
  return String(value).trim().toLowerCase()
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((entry, index) => entry === right[index])
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

const portraitManifestBytes = await readFile(portraitManifestPath)
const portraitManifest = JSON.parse(portraitManifestBytes.toString("utf8"))
const modelManifestBytes = await readFile(resolve(modelDirectory, "manifest.json"))
const modelManifest = JSON.parse(modelManifestBytes.toString("utf8"))
const releaseLabels = await readJson(resolve(modelDirectory, modelManifest.labelsFile))

if (!Array.isArray(portraitManifest.champions) || portraitManifest.champions.length < 150) {
  throw new Error("The local Data Dragon portrait manifest is incomplete")
}
if (!Array.isArray(releaseLabels) || releaseLabels.length < 150) {
  throw new Error("The bundled minimap model labels are incomplete")
}

const classes = portraitManifest.champions
  .map((champion) => ({
    assetKey: String(champion.assetKey),
    displayName: String(champion.name),
    riotId: Number(champion.id),
    file: String(champion.file),
    portraitSha256: String(champion.sha256),
  }))
  .sort((left, right) => left.assetKey < right.assetKey ? -1 : left.assetKey > right.assetKey ? 1 : 0)
  .map((champion, index) => ({ index, ...champion }))

const duplicateClass = classes.find((entry, index) =>
  classes.findIndex((candidate) => normalize(candidate.assetKey) === normalize(entry.assetKey)) !== index)
if (duplicateClass) throw new Error(`Duplicate champion asset key: ${duplicateClass.assetKey}`)

const targetClassNames = classes.map((entry) => entry.assetKey)
const targetByName = new Set(targetClassNames.map(normalize))
const removedClasses = releaseLabels.filter((label) => !targetByName.has(normalize(label)))
if (removedClasses.length > 0) {
  throw new Error(`Model labels are absent from Data Dragon: ${removedClasses.join(", ")}`)
}

let existingRoster
try {
  existingRoster = await readJson(rosterPath)
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}

const existingBaseModel = existingRoster?.baseModel
if (existingRoster && (!Array.isArray(existingBaseModel?.classNames) ||
    existingBaseModel.classNames.length < 150)) {
  throw new Error("The existing training roster has no valid pinned base model")
}
const baseModel = existingBaseModel ?? {
  repository: modelManifest.repository,
  revision: modelManifest.revision,
  sourceFile: modelManifest.sourceFile,
  sourceSha256: modelManifest.sourceSha256,
  artifactSha256: modelManifest.artifactSha256,
  classCount: releaseLabels.length,
  classNames: releaseLabels,
}
const baseClassNames = baseModel.classNames
const baseNames = new Set(baseClassNames.map(normalize))
const focusChampions = targetClassNames.filter((name) => !baseNames.has(normalize(name)))

const roster = {
  schemaVersion: 1,
  dataDragon: {
    patch: portraitManifest.patch,
    locale: portraitManifest.locale,
    source: portraitManifest.source,
    manifestSha256: sha256(portraitManifestBytes),
  },
  upstreamToolkit: {
    repository: "https://github.com/bsowlx/DeepestLeague",
    revision: "8cb084f6ae9a89362d30dc2200e775d91cf66f64",
  },
  baseModel,
  classCount: classes.length,
  classes,
  focusChampions,
}

const serialized = `${JSON.stringify(roster, null, 2)}\n`

if (update) {
  if (focusChampions.length === 0 && !existingRoster) {
    throw new Error("The bundled model already covers the complete local champion roster")
  }
  await writeFile(rosterPath, serialized, "utf8")
  console.log(`Saved ${classes.length}-class training roster for Data Dragon ${portraitManifest.patch}.`)
  console.log(`Classes absent from the base checkpoint: ${focusChampions.join(", ") || "none"}.`)
}

if (check) {
  if (!existingRoster) {
    throw new Error("Training roster is missing; run pnpm sync:minimap-training-roster")
  }
  const existingTarget = existingRoster.classes?.map((entry) => entry.assetKey)
  if (!sameArray(existingTarget, targetClassNames)) {
    throw new Error("The training roster does not match local portraits; run pnpm sync:minimap-training-roster")
  }
  if (existingRoster.dataDragon?.manifestSha256 !== roster.dataDragon.manifestSha256) {
    throw new Error("The portrait manifest changed; run pnpm sync:minimap-training-roster")
  }
  const releaseNames = new Set(releaseLabels.map(normalize))
  const orderedReleaseLabels = existingTarget.filter((name) => releaseNames.has(normalize(name)))
  const releaseCoversBase = existingRoster.baseModel.classNames.every((name) =>
    releaseNames.has(normalize(name)))
  if (releaseNames.size !== releaseLabels.length || !releaseCoversBase ||
      !sameArray(orderedReleaseLabels, releaseLabels)) {
    throw new Error(
      "Bundled model labels are not an ordered, base-complete subset of the training roster",
    )
  }
  const expectedFocus = existingTarget.filter((name) =>
    !new Set(existingRoster.baseModel.classNames.map(normalize)).has(normalize(name)))
  if (!sameArray(existingRoster.focusChampions, expectedFocus)) {
    throw new Error("Training roster focus champions are inconsistent with its base checkpoint")
  }
  console.log(
    `Minimap training roster is consistent (${existingRoster.classCount} classes; ` +
    `${existingRoster.focusChampions.length} additions: ${existingRoster.focusChampions.join(", ") || "none"}).`,
  )
}
