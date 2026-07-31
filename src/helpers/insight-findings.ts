import { itemAsset, type ItemAsset } from "./items"

interface FindingCopy {
  key: string
  title: string
  summary: string
}

export function findingItemAsset(finding: Pick<FindingCopy, "key">): ItemAsset | undefined {
  const match = /^item:(\d+)$/.exec(finding.key)
  return match ? itemAsset(Number(match[1])) : undefined
}

export function findingLabel(finding: Pick<FindingCopy, "key" | "title">): string {
  return findingItemAsset(finding)?.name ?? finding.title
}

export function findingSummary(finding: FindingCopy): string {
  const item = findingItemAsset(finding)
  if (!item) return finding.summary

  const itemId = finding.key.slice("item:".length)
  return finding.summary.replace(new RegExp(`\\bitem\\s+${itemId}\\b`, "gi"), item.name)
}