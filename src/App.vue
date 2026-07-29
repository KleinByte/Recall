<script setup lang="ts">
import { onMounted, ref } from "vue"
import AppSidebar from "./components/AppSidebar.vue"
import ChampSelectBanner from "./components/ChampSelectBanner.vue"
import ChampionDetail from "./components/ChampionDetail.vue"
import MatchSheet from "./components/MatchSheet.vue"
import PostGameBanner from "./components/PostGameBanner.vue"
import ChallengesPage from "./pages/ChallengesPage.vue"
import ChampionsPage from "./pages/ChampionsPage.vue"
import DashboardPage from "./pages/DashboardPage.vue"
import LiveGamePage from "./pages/LiveGamePage.vue"
import MatchesPage from "./pages/MatchesPage.vue"
import ProgressPage from "./pages/ProgressPage.vue"
import SettingsPage from "./pages/SettingsPage.vue"
import SkillPage from "./pages/SkillPage.vue"
import { api } from "./helpers/api"
import { loadDataDragonVersion } from "./helpers/ddragon"
import { detailChampionId, detailMatch, page } from "./helpers/navigation"
import { parseMerakiFile } from "./helpers/utils"
import type { AramStats, Champion, Summoner } from "./types/lol"
import type { MatchRow } from "./types/stats"
import type { StoredSettings } from "./types/app"
import type { LiveSession } from "./types/live"

const connected = ref(false)
const summoner = ref<Summoner | null>(null)
const allChampions = ref<Champion[] | null>(null)
const stats = ref<AramStats | null>(null)
const lastGame = ref<MatchRow | null>(null)
const refreshing = ref(false)
const refreshMessage = ref<string | null>(null)
let hasFocusedLiveGame = false

const isColoredWhenDone = ref(false)
const showChampionNames = ref(false)

async function fetchAramStats() {
  const response = await fetch(
    "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json",
    { cache: "no-cache" },
  )
  const parsed = parseMerakiFile(await response.json())
  api.setSetting("aram-stats", JSON.stringify(parsed))
  stats.value = parsed
}

async function loadChampions() {
  if (!connected.value) return

  try {
    const currentSummoner = summoner.value ?? (await api.getSummoner())
    summoner.value = currentSummoner
    allChampions.value = await api.getChampions(currentSummoner.summonerId)
  } catch (error) {
    console.warn("Could not load champion data", error)
  }
}

async function loadSettings() {
  const storedSettings = await api.getSetting<string>("settings")
  if (storedSettings) {
    const parsed: StoredSettings = JSON.parse(storedSettings)
    isColoredWhenDone.value = parsed.isColoredWhenDone
    showChampionNames.value = parsed.showChampionNames
  }
}

function persistSettings() {
  api.setSetting(
    "settings",
    JSON.stringify({
      isColoredWhenDone: isColoredWhenDone.value,
      showChampionNames: showChampionNames.value,
    }),
  )
}

async function refreshAll() {
  if (refreshing.value || !connected.value) return

  refreshing.value = true
  refreshMessage.value = null
  try {
    const result = await api.refreshAll()
    refreshMessage.value = result.inserted > 0
      ? `Refreshed: ${result.inserted} new match${result.inserted === 1 ? "" : "es"}`
      : "Refresh complete"
  } catch (error) {
    console.warn("Could not refresh client data", error)
    refreshMessage.value = "Refresh failed — check that League is open"
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  api.notifyReady()
  void loadDataDragonVersion()

  const storedStats = await api.getSetting<string>("aram-stats")
  if (storedStats) {
    stats.value = JSON.parse(storedStats)
  } else {
    void fetchAramStats()
  }

  await loadSettings()

  const status = await api.getStatus()
  connected.value = status.connected
  summoner.value = status.summoner
  if (status.connected) void loadChampions()

  api.on(
    "lcu:status",
    (payload: { connected: boolean; summoner: Summoner | null }) => {
      connected.value = payload.connected
      summoner.value = payload.summoner
      if (payload.connected) void loadChampions()
    },
  )

  api.on("live:updated", (live: LiveSession) => {
    if (live.phase === "Idle") {
      hasFocusedLiveGame = false
    } else if (!hasFocusedLiveGame) {
      page.value = "live"
      hasFocusedLiveGame = true
    }
  })

  // Shown wherever the user happens to be, and never steals focus.
  api.on("match:recorded", (match: MatchRow) => {
    lastGame.value = match
  })
})
</script>

<template>
  <div class="app">
    <AppSidebar
      :page="page"
      :connected="connected"
      :summoner="summoner"
      :refreshing="refreshing"
      :refresh-message="refreshMessage"
      @update:page="page = $event"
      @refresh="refreshAll"
    />

    <main class="content">
      <ChampSelectBanner :champions="allChampions" />

      <PostGameBanner
        v-if="lastGame"
        :match="lastGame"
        :champions="allChampions"
        @dismiss="lastGame = null"
      />

      <DashboardPage
        v-if="page === 'dashboard'"
        :champions="allChampions"
        :connected="connected"
      />

      <LiveGamePage
        v-else-if="page === 'live'"
        :champions="allChampions"
      />

      <ChallengesPage
        v-else-if="page === 'challenges'"
        :champions="allChampions"
        :connected="connected"
        :is-colored-when-done="isColoredWhenDone"
        :show-champion-names="showChampionNames"
      />

      <MatchesPage
        v-else-if="page === 'matches'"
        :champions="allChampions"
        :connected="connected"
      />

      <SkillPage
        v-else-if="page === 'skill'"
        :champions="allChampions"
        :connected="connected"
      />

      <ProgressPage
        v-else-if="page === 'progress'"
        :champions="allChampions"
        :connected="connected"
      />

      <ChampionsPage
        v-else-if="page === 'champions'"
        :champions="allChampions"
        :connected="connected"
      />

      <SettingsPage
        v-else-if="page === 'settings'"
        :is-colored-when-done="isColoredWhenDone"
        :show-champion-names="showChampionNames"
        :connected="connected"
        @update:is-colored-when-done="
          isColoredWhenDone = $event;
          persistSettings()
        "
        @update:show-champion-names="
          showChampionNames = $event;
          persistSettings()
        "
        @refetch="loadChampions"
        @refetch-aram-stats="fetchAramStats"
      />
    </main>

    <ChampionDetail
      v-if="detailChampionId !== null"
      :champion-id="detailChampionId"
      :champions="allChampions"
    />

    <MatchSheet
      v-if="detailMatch"
      :match="detailMatch"
      :champions="allChampions"
    />
  </div>
</template>

<style>
.app {
  display: flex;
  height: 100vh;
  background: var(--surface-0);
  color: var(--text-primary);
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-5);
}
</style>
