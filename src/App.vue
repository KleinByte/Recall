<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from "vue"
import AppSidebar from "./components/AppSidebar.vue"
import ChampSelectBanner from "./components/ChampSelectBanner.vue"
import PatchNotesModal from "./components/PatchNotesModal.vue"
import PostGameBanner from "./components/PostGameBanner.vue"
import UpdateReadyBanner from "./components/UpdateReadyBanner.vue"
import WindowTitleBar from "./components/WindowTitleBar.vue"
import DashboardPage from "./pages/DashboardPage.vue"
import {
  currentAppVersion,
  hasUnseenPatchNotes,
} from "./data/patch-notes"
import { api } from "./helpers/api"
import { useApiEvents } from "./helpers/use-api-events"
import { loadDataDragonVersion } from "./helpers/ddragon"
import {
  detailChampionId,
  goTo,
  page,
  reviewMatch,
} from "./helpers/navigation"
import { parseMerakiFile } from "./helpers/utils"
import type { AramStats, Champion, Summoner } from "./types/lol"
import type { MatchRow } from "./types/stats"
import type { StoredSettings } from "./types/app"
import type { LiveSession } from "./types/live"
import type { UpdateStatus } from "./types/update"

const ChampionDetail = defineAsyncComponent(() => import("./components/ChampionDetail.vue"))
const ChallengesPage = defineAsyncComponent(() => import("./pages/ChallengesPage.vue"))
const ChampionsPage = defineAsyncComponent(() => import("./pages/ChampionsPage.vue"))
const LiveGamePage = defineAsyncComponent(() => import("./pages/LiveGamePage.vue"))
const MatchesPage = defineAsyncComponent(() => import("./pages/MatchesPage.vue"))
const ProgressPage = defineAsyncComponent(() => import("./pages/ProgressPage.vue"))
const ReviewPage = defineAsyncComponent(() => import("./pages/ReviewPage.vue"))
const SettingsPage = defineAsyncComponent(() => import("./pages/SettingsPage.vue"))
const SkillPage = defineAsyncComponent(() => import("./pages/SkillPage.vue"))

const connected = ref(false)
const summoner = ref<Summoner | null>(null)
const allChampions = ref<Champion[] | null>(null)
const stats = ref<AramStats | null>(null)
const lastGame = ref<MatchRow | null>(null)
const refreshing = ref(false)
const refreshMessage = ref<string | null>(null)
const showPatchNotes = ref(false)
const updateStatus = ref<UpdateStatus>({ kind: "up-to-date" })
const dismissedUpdateVersion = ref<string | null>(null)
let hasFocusedLiveGame = false
const events = useApiEvents()

const isColoredWhenDone = ref(false)
const showChampionNames = ref(false)
const sidebarCollapsed = ref(false)

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
  try {
    allChampions.value = await api.getChampions()
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
    sidebarCollapsed.value = parsed.sidebarCollapsed ?? false
  }
}

function persistSettings() {
  api.setSetting(
    "settings",
    JSON.stringify({
      isColoredWhenDone: isColoredWhenDone.value,
      showChampionNames: showChampionNames.value,
      sidebarCollapsed: sidebarCollapsed.value,
    }),
  )
}

async function showUnseenPatchNotes() {
  const seenVersion = await api.getSetting<string>(
    "last-seen-patch-notes-version",
  )
  if (!hasUnseenPatchNotes(seenVersion)) return

  showPatchNotes.value = true
  api.setSetting("last-seen-patch-notes-version", currentAppVersion)
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
  void showUnseenPatchNotes()

  const storedStats = await api.getSetting<string>("aram-stats")
  if (storedStats) {
    stats.value = JSON.parse(storedStats)
  } else {
    void fetchAramStats()
  }

  await loadSettings()
  await loadChampions()

  const status = await api.getStatus()
  connected.value = status.connected
  summoner.value = status.summoner
  if (status.connected) void loadChampions()

  events.on(
    "lcu:status",
    (payload: { connected: boolean; summoner: Summoner | null }) => {
      connected.value = payload.connected
      summoner.value = payload.summoner
      if (payload.connected) void loadChampions()
    },
  )

  events.on("live:updated", (live: LiveSession) => {
    if (live.phase === "Idle") {
      hasFocusedLiveGame = false
    } else if (!hasFocusedLiveGame) {
      goTo("live")
      hasFocusedLiveGame = true
    }
  })

  events.onUpdateStatus((status) => {
    updateStatus.value = status
  })
  void api.getUpdateStatus().then((status) => {
    updateStatus.value = status
  })

  // Shown wherever the user happens to be, and never steals focus.
  events.on("match:recorded", (match: MatchRow) => {
    lastGame.value = match
  })
})
</script>

<template>
  <div class="app-window">
    <WindowTitleBar />

    <div class="app">
      <AppSidebar
        :page="page"
        :connected="connected"
        :summoner="summoner"
        :refreshing="refreshing"
        :refresh-message="refreshMessage"
        :collapsed="sidebarCollapsed"
        @update:page="goTo"
        @update:collapsed="sidebarCollapsed = $event; persistSettings()"
        @refresh="refreshAll"
      />

      <main class="content">
        <ChampSelectBanner :champions="allChampions" />

        <PostGameBanner
          v-if="lastGame"
          :match="lastGame"
          :champions="allChampions"
          @dismiss="lastGame = null"
          @review="reviewMatch"
        />

        <UpdateReadyBanner
          v-if="updateStatus.kind === 'downloaded' && dismissedUpdateVersion !== updateStatus.version"
          :status="updateStatus"
          @dismiss="dismissedUpdateVersion = updateStatus.version"
        />

        <DashboardPage
          v-if="page === 'dashboard'"
          :champions="allChampions"
          :connected="connected"
        />

        <LiveGamePage
          v-else-if="page === 'live'"
          :champions="allChampions"
          :aram-stats="stats"
        />

        <ReviewPage
          v-else-if="page === 'review'"
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
          @view-patch-notes="showPatchNotes = true"
        />
      </main>

      <ChampionDetail
        v-if="detailChampionId !== null"
        :champion-id="detailChampionId"
        :champions="allChampions"
      />

      <PatchNotesModal
        v-if="showPatchNotes"
        @close="showPatchNotes = false"
      />
    </div>
  </div>
</template>

<style>
.app-window {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--surface-0);
}

.app {
  display: flex;
  min-height: 0;
  flex: 1;
  background: var(--surface-0);
  color: var(--text-primary);
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 28px clamp(var(--space-4), 2.4vw, var(--space-6));
  background:
    radial-gradient(circle at 82% 0%, rgba(10, 203, 230, 0.045), transparent 32%),
    radial-gradient(circle at 15% 0%, rgba(200, 170, 109, 0.055), transparent 28%),
    var(--surface-0);
}

@media (max-width: 700px) {
  .content {
    padding: var(--space-4);
  }
}
</style>
