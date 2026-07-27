import { ref } from "vue"
import { api } from "./api"

/**
 * Item and spell art comes from Data Dragon, which is versioned by patch.
 *
 * The version is fetched once and remembered, so every icon after the first
 * costs nothing. A stale-but-working version is far better than no icons, so
 * the last known one is kept and a sensible default stands in until the first
 * fetch lands.
 */
const FALLBACK_VERSION = "16.14.1"

const version = ref(FALLBACK_VERSION)

export async function loadDataDragonVersion() {
  const cached = await api.getSetting<string>("ddragon-version")
  if (cached) version.value = cached

  try {
    const response = await fetch(
      "https://ddragon.leagueoflegends.com/api/versions.json",
      { cache: "no-cache" },
    )
    const versions = (await response.json()) as string[]

    if (versions[0]) {
      version.value = versions[0]
      api.setSetting("ddragon-version", versions[0])
    }
  } catch {
    // Offline, or Riot's CDN is having a day. The cached version still works.
  }
}

const base = () => `https://ddragon.leagueoflegends.com/cdn/${version.value}`

/** An empty item slot is stored as 0 and has no art. */
export const itemIconUrl = (itemId: number) =>
  itemId > 0 ? `${base()}/img/item/${itemId}.png` : undefined

export const summonerSpellIconUrl = (spellId: number) => {
  const key = SUMMONER_SPELLS[spellId]
  return key ? `${base()}/img/spell/${key}.png` : undefined
}

/**
 * Data Dragon names summoner spell art by key rather than id, so the two have
 * to be bridged. These are the spells that appear in the modes Recall tracks.
 */
const SUMMONER_SPELLS: Record<number, string> = {
  1: "SummonerBoost",
  3: "SummonerExhaust",
  4: "SummonerFlash",
  6: "SummonerHaste",
  7: "SummonerHeal",
  11: "SummonerSmite",
  12: "SummonerTeleport",
  13: "SummonerMana",
  14: "SummonerDot",
  21: "SummonerBarrier",
  30: "SummonerPoroRecall",
  31: "SummonerPoroThrow",
  32: "SummonerSnowball",
  39: "SummonerSnowURFSnowball_Mark",
  54: "Summoner_UltBookPlaceholder",
  55: "Summoner_UltBookSmitePlaceholder",
}
