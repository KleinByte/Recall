import { shallowRef } from "vue"
import type { RuneSelection } from "../types/stats"
import catalog from "../data/rune-catalog.json"

export interface RuneMeta {
  id: number
  name: string
  shortDesc?: string
  longDesc?: string
  iconPath?: string
  endOfGameStatDescs?: string[]
  type?: string
  statName?: string
  tooltip?: string
}

export interface RuneStyle {
  id: number
  name: string
  iconPath?: string
  slots: { type: string; label: string; perks: number[] }[]
}

export const runeMetadata = shallowRef<Record<number, RuneMeta>>(Object.fromEntries(
  [...catalog.modern, ...catalog.classic].map((entry) => [entry.id, entry]),
))
export const runeStyles = shallowRef<Record<number, RuneStyle>>(Object.fromEntries(
  catalog.styles.map((style) => [style.id, style]),
))
let loading: Promise<void> | undefined

export const runeIconUrl = (runeId: number) =>
  runeMetadata.value[runeId] ? `/game-data/runes/${runeId}.png` : undefined

export const runeStyleIconUrl = (styleId: number) =>
  runeStyles.value[styleId] ? `/game-data/rune-styles/${styleId}.png` : undefined

export function loadRuneMetadata() {
  if (loading) return loading
  // Metadata and art are generated at build time so review pages remain
  // complete when Riot's CDNs are unavailable or the user is offline.
  loading = Promise.resolve()
  return loading
}

const stripMarkup = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
const compact = (value: number) => Math.abs(value) >= 1_000
  ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
  : value.toLocaleString()

export function runeMetrics(selection: RuneSelection) {
  const meta = runeMetadata.value[selection.runeId]
  const values = [selection.var1, selection.var2, selection.var3]
  const described = (meta?.endOfGameStatDescs ?? []).flatMap((description, index) => {
    if (!description || description === "--") return []
    const value = values[index] ?? 0
    return [stripMarkup(description.replaceAll(`@eogvar${index + 1}@`, compact(value)))]
  })
  if (described.length) return described
  return values.flatMap((value, index) => value ? [`Metric ${index + 1}: ${compact(value)}`] : [])
}
