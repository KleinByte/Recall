import type { Champion } from "../types/lol"
import championCatalog from "../data/champions.json"
import { publicAssetUrl } from "./assets"
import { RECALL_GRADES, recallGradeFromScore } from "../shared/recall-grade"

const offlineChampionNames = championCatalog as Record<string, string>

export const championIconUrl = (championId: number) =>
  championId > 0
    ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`
    : publicAssetUrl("recall-icon.png")

export function championNameById(
  champions: Champion[] | null,
  championId: number,
): string {
  return (
    champions?.find((champion) => champion.id === championId)?.name ??
    offlineChampionNames[String(championId)] ??
    `Champion ${championId}`
  )
}

export const formatPercent = (value: number) => `${Math.round(value * 100)}%`

export const formatDecimal = (value: number, digits = 1) =>
  value.toFixed(digits)

export function formatCompact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return Math.round(value).toString()
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const rest = rounded % 60
  return `${minutes}:${rest.toString().padStart(2, "0")}`
}

export function formatRelativeDate(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs
  const minutes = Math.round(diffMs / 60_000)

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`

  return new Date(timestampMs).toLocaleDateString()
}

export const formatStreak = (streak: number) => {
  if (streak === 0) return "—"
  return streak > 0 ? `${streak}W` : `${Math.abs(streak)}L`
}

export const modeLabel = (mode: string) => {
  switch (mode) {
    case "mayhem":
      return "Mayhem"
    case "aram":
      return "ARAM"
    case "sr_ranked_solo":
      return "Ranked Solo"
    case "sr_ranked_flex":
      return "Ranked Flex"
    case "sr_quickplay":
      return "Quickplay"
    case "sr_swiftplay":
      return "Swiftplay"
    case "sr_normal":
      return "Normal"
    case "other":
      return "Other"
    default:
      return mode
  }
}

export function gradeFromScore(score?: number): string | undefined {
  return recallGradeFromScore(score)
}

export const GRADE_ORDER = [...RECALL_GRADES]
