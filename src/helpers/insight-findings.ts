import { itemAsset, type ItemAsset } from "./items"
import { championNameById } from "./format"
import type { Champion } from "../types/lol"

interface FindingCopy {
  key: string
  title: string
  summary: string
}

export function findingItemAsset(finding: Pick<FindingCopy, "key">): ItemAsset | undefined {
  const match = /^item:(\d+)$/.exec(finding.key)
  return match ? itemAsset(Number(match[1])) : undefined
}

export function findingChampionId(finding: Pick<FindingCopy, "key">): number | undefined {
  const match = /^champion:(\d+)$/.exec(finding.key)
  return match ? Number(match[1]) : undefined
}

export function findingLabel(
  finding: Pick<FindingCopy, "key" | "title">,
  champions: Champion[] | null = null,
): string {
  const championId = findingChampionId(finding)
  return findingItemAsset(finding)?.name ??
    (championId === undefined ? finding.title : championNameById(champions, championId))
}

export function findingSummary(
  finding: FindingCopy,
  champions: Champion[] | null = null,
): string {
  const item = findingItemAsset(finding)
  if (item) {
    const itemId = finding.key.slice("item:".length)
    return finding.summary.replace(new RegExp(`\\bitem\\s+${itemId}\\b`, "gi"), item.name)
  }

  const championId = findingChampionId(finding)
  if (championId === undefined) return finding.summary
  const name = championNameById(champions, championId)
  return finding.summary.replace(new RegExp(`\\bchampion\\s+${championId}\\b`, "gi"), name)
}
