<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from "vue"
import AppSidebar from "./components/AppSidebar.vue"
import ChampSelectBanner from "./components/ChampSelectBanner.vue"
import PatchNotesModal from "./components/PatchNotesModal.vue"
import PostGameBanner from "./components/PostGameBanner.vue"
import UpdateRecallAnimation from "./components/UpdateRecallAnimation.vue"
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
import type { MatchRow, PersonalRecord } from "./types/stats"
import type { StoredSettings } from "./types/app"
import type { LiveSession } from "./types/live"
import type { RecordNotification } from "./types/notifications"
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
const lastGameRecords = ref<PersonalRecord[]>([])
const recordNotifications = ref<RecordNotification[]>([])
const refreshing = ref(false)
const refreshMessage = ref<string | null>(null)
const showPatchNotes = ref(false)
const updateStatus = ref<UpdateStatus>({ kind: "up-to-date" })
const dismissedUpdateVersion = ref<string | null>(null)
const startupAnimation = ref(true)
const startupAnimationPhase = ref<"startup" | "arrival">("startup")
const updateAnimation = ref<{
  phase: "channeling" | "arrival"
  version: string
} | null>(null)
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
  void api.saveAramStats(parsed)
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
  const storedSettings = await api.getUiSettings()
  if (storedSettings) {
    isColoredWhenDone.value = storedSettings.isColoredWhenDone
    showChampionNames.value = storedSettings.showChampionNames
    sidebarCollapsed.value = storedSettings.sidebarCollapsed
  }
}

function persistSettings() {
  void api.saveUiSettings({
    isColoredWhenDone: isColoredWhenDone.value,
    showChampionNames: showChampionNames.value,
    sidebarCollapsed: sidebarCollapsed.value,
  })
}

async function runStartupTransition() {
  let seenVersion: string | undefined
  try {
    seenVersion = await api.getLastSeenPatchNotesVersion()
  } catch {
    // Startup animation should still complete if settings are unavailable.
  }

  const hasNewPatchNotes = hasUnseenPatchNotes(seenVersion)
  startupAnimationPhase.value = seenVersion && hasNewPatchNotes
    ? "arrival"
    : "startup"

  const duration = 2_700
  await new Promise((resolve) => setTimeout(resolve, duration))
  startupAnimation.value = false

  if (!hasNewPatchNotes) return
  showPatchNotes.value = true
  void api.saveLastSeenPatchNotesVersion(currentAppVersion)
}

async function installUpdateWithRecall() {
  if (updateAnimation.value) return
  const version = updateStatus.value.kind === "downloaded"
    ? updateStatus.value.version
    : ""
  updateAnimation.value = { phase: "channeling", version }
  await new Promise((resolve) => setTimeout(resolve, 2_500))
  try {
    const installing = await api.installUpdate()
    if (!installing) updateAnimation.value = null
  } catch {
    updateAnimation.value = null
  }
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

function markRecordNotificationsRead() {
  recordNotifications.value = recordNotifications.value.map((notification) => ({
    ...notification,
    read: true,
  }))
}

function clearRecordNotifications() {
  recordNotifications.value = []
}

function openRecordNotification(gameId: number) {
  markRecordNotificationsRead()
  reviewMatch(gameId)
}

onMounted(async () => {
  api.notifyReady()
  void loadDataDragonVersion()
  void runStartupTransition()

  const storedStats = await api.getAramStats<AramStats>()
  if (storedStats) {
    stats.value = storedStats
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
    lastGameRecords.value = []
  })
  events.on("match:records", (payload: { gameId: number; records: PersonalRecord[] }) => {
    if (lastGame.value?.gameId === payload.gameId) {
      lastGameRecords.value = payload.records
    }
  })
  events.on("record:notification", (payload: {
    gameId: number
    records: PersonalRecord[]
    createdAt: number
  }) => {
    if (!payload.records.length) return
    const recordKeys = payload.records.map((record) => record.key).sort().join("|")
    const id = `${payload.gameId}:${recordKeys}`
    if (recordNotifications.value.some((entry) => entry.id === id)) return
    recordNotifications.value = [
      {
        id,
        gameId: payload.gameId,
        records: payload.records,
        createdAt: payload.createdAt,
        read: false,
      },
      ...recordNotifications.value,
    ].slice(0, 20)
  })
})
</script>

<template>
  <div class="app-window">
    <WindowTitleBar
      :record-notifications="recordNotifications"
      @mark-records-read="markRecordNotificationsRead"
      @clear-records="clearRecordNotifications"
      @open-record="openRecordNotification"
    />

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
          :records="lastGameRecords"
          :champions="allChampions"
          @dismiss="lastGame = null; lastGameRecords = []"
          @review="reviewMatch"
        />

        <UpdateReadyBanner
          v-if="updateStatus.kind === 'downloaded' && dismissedUpdateVersion !== updateStatus.version"
          :status="updateStatus"
          @dismiss="dismissedUpdateVersion = updateStatus.version"
          @install="installUpdateWithRecall"
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
          @install-update="installUpdateWithRecall"
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

      <UpdateRecallAnimation
        v-if="startupAnimation"
        :phase="startupAnimationPhase"
        :version="currentAppVersion"
      />

      <UpdateRecallAnimation
        v-if="updateAnimation"
        :phase="updateAnimation.phase"
        :version="updateAnimation.version"
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
  background: var(--ui-canvas);
}

.app {
  display: flex;
  min-height: 0;
  flex: 1;
  background: var(--ui-canvas);
  color: var(--ui-text);
}

.content {
  container-name: recall-content;
  container-type: inline-size;
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 28px clamp(var(--space-4), 2.4vw, var(--space-6));
  background:
    radial-gradient(circle at 82% 0%, var(--ui-page-ambient-energy), transparent 32%),
    radial-gradient(circle at 15% 0%, var(--ui-page-ambient-metal), transparent 28%),
    var(--ui-canvas);
}

@media (max-width: 700px) {
  .content {
    padding: var(--space-4);
  }
}
</style>
