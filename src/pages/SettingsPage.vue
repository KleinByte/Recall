<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import {
  Button as UiButton,
  EmptyState,
  Field as UiField,
  PageHeader,
  Panel,
  Surface,
  Tabs as UiTabs,
} from "../components/ui"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import { updatePresentation } from "../helpers/update"
import { modeLabel } from "../helpers/format"
import type { UpdateStatus } from "../types/update"
import type { TempoOverlayStatus } from "../types/app"
import type {
  PerformanceReferenceStatus,
  RiotHistoryBackfillState,
  StatsMeta,
} from "../types/stats"
import type { DataTrustReport } from "../types/review"

const props = defineProps<{
  isColoredWhenDone: boolean
  showChampionNames: boolean
  connected: boolean
}>()
const events = useApiEvents()

const emit = defineEmits<{
  (event: "update:isColoredWhenDone", value: boolean): void
  (event: "update:showChampionNames", value: boolean): void
  (event: "refetch"): void
  (event: "refetch-aram-stats"): void
  (event: "view-patch-notes"): void
  (event: "install-update"): void
}>()

const meta = ref<StatsMeta | null>(null)
const busy = ref(false)
const message = ref("")
const updateStatus = ref<UpdateStatus>({ kind: "checking" })
const update = computed(() => updatePresentation(updateStatus.value))
const riotApiKey = ref("")
const riotKeyConfigured = ref(false)
const riotKeyProtected = ref(false)
const riotKeyMessage = ref("")
const riotHistory = ref<RiotHistoryBackfillState>()
const trust = ref<DataTrustReport>()
const trustBusy = ref(false)
const launchAtLogin = ref(true)
const minimapTelemetryEnabled = ref(true)
const isDevelopment = import.meta.env.DEV
const settingsTab = ref("general")
const settingsTabs = [
  { value: "general", label: "General" },
  { value: "gameplay", label: "Gameplay" },
  { value: "riot-history", label: "Riot & history" },
  { value: "data", label: "Data" },
  ...(isDevelopment ? [{ value: "development", label: "Development" }] : []),
]
const settingsPanelTitle = computed(() => {
  if (settingsTab.value === "general") return "General preferences"
  if (settingsTab.value === "gameplay") return "Gameplay & overlays"
  return "Development tools"
})
const minimapVisionDebugEnabled = ref(false)
const minimapVisionOverlayEnabled = ref(false)
const displayTimezone = ref("")
const resolvedTimezone = ref("UTC")
const timezoneMessage = ref("")
const recall = ref<PerformanceReferenceStatus>()
const rebuildingReference = ref(false)
const referenceMessage = ref("")
const tempoOverlay = ref<TempoOverlayStatus>({
  visible: false,
  locked: false,
  shortcutRegistered: false,
})

const riotHistoryMessage = computed(() => {
  const history = riotHistory.value
  if (!history) {
    return props.connected
      ? "Save a key, then explicitly start the Match-V5 history import for this account."
      : "Connect the League client so Recall can identify the account and regional route."
  }

  if (history.status === "complete") {
    return `History scan complete: ${history.idsScanned.toLocaleString()} IDs scanned, ${history.matchesImported.toLocaleString()} new matches imported.`
  }
  if (history.status === "error") {
    return history.lastError || "The Riot history import stopped."
  }
  if (history.status === "paused") {
    return `History import paused after ${history.idsScanned.toLocaleString()} IDs. It will resume when the client reconnects.`
  }
  return `Scanning in the background: ${history.idsScanned.toLocaleString()} IDs scanned, ${history.matchesImported.toLocaleString()} new matches imported. Riot rate limits may pause requests temporarily.`
})

async function loadMeta() {
  meta.value = await api.getStatsMeta()
}

const refreshTrust = useCoalescedTask(() => loadTrust())

onMounted(() => {
  void loadMeta()
  events.on("stats:updated", () => void loadMeta())
  void api.getUpdateStatus().then((status) => { updateStatus.value = status })
  events.onUpdateStatus((status) => { updateStatus.value = status })
  void api.getRiotApiKeyStatus().then((status) => {
    riotKeyConfigured.value = status.configured
    riotKeyProtected.value = status.protected
    riotHistory.value = status.history
  })
  events.on("riot-history:updated", (status: RiotHistoryBackfillState) => {
    riotHistory.value = status
  })
  void refreshTrust()
  events.on("data-trust:updated", () => void refreshTrust())
  void api.getLaunchAtLogin().then((value) => {
    launchAtLogin.value = value !== false
  })
  void api.getMinimapTelemetryEnabled().then((value) => {
    minimapTelemetryEnabled.value = value !== false
  })
  if (isDevelopment) {
    void api.getMinimapVisionDebugEnabled().then((value) => {
      minimapVisionDebugEnabled.value = value === true
    })
    void api.getMinimapVisionDebugOverlayEnabled().then((value) => {
      minimapVisionOverlayEnabled.value = value === true
    })
  }
  void api.getDisplayTimezone().then((value) => {
    displayTimezone.value = value.override ?? ""
    resolvedTimezone.value = value.timeZone
  })
  events.on("recall:timezone-changed", (value: { timeZone: string; override?: string }) => {
    displayTimezone.value = value.override ?? ""
    resolvedTimezone.value = value.timeZone
  })
  void api.getTempoOverlayStatus().then((status) => { tempoOverlay.value = status })
  events.on("tempo-overlay:status", (status: TempoOverlayStatus) => {
    tempoOverlay.value = status
  })
  void loadRecall()
  events.on("performance-reference:updated", (status: PerformanceReferenceStatus) => {
    recall.value = status
  })
})

async function loadRecall() {
  recall.value = await api.getPerformanceReferenceStatus()
}

async function rebuildPerformanceReference() {
  rebuildingReference.value = true
  referenceMessage.value = ""
  try {
    const result = await api.rebuildPerformanceReference()
    if (result.canceled) return
    referenceMessage.value = result.errors
      ? `Recalibrated all eligible modes with ${result.errors} errors. Your backup was retained.`
      : `Recalibrated all eligible modes. ${result.ready ?? 0} recorded matches have complete grades.`
    await Promise.all([loadRecall(), loadMeta()])
  } catch (error) {
    referenceMessage.value = (error as Error).message
  } finally {
    rebuildingReference.value = false
  }
}

function setLaunchAtLogin(value: boolean) {
  launchAtLogin.value = value
  void api.saveLaunchAtLogin(value)
}

async function saveTimezone() {
  timezoneMessage.value = ""
  try {
    const result = await api.saveDisplayTimezone(displayTimezone.value.trim())
    displayTimezone.value = result.override
    resolvedTimezone.value = result.timeZone
    timezoneMessage.value = "Display timezone saved."
  } catch {
    timezoneMessage.value = "Enter a valid IANA timezone, such as America/Chicago."
  }
}

async function useSystemTimezone() {
  const result = await api.useSystemTimezone()
  displayTimezone.value = ""
  resolvedTimezone.value = result.timeZone
  timezoneMessage.value = "Using the system timezone."
}

function setMinimapTelemetryEnabled(value: boolean) {
  minimapTelemetryEnabled.value = value
  void api.saveMinimapTelemetryEnabled(value)
}

function setMinimapVisionDebugEnabled(value: boolean) {
  minimapVisionDebugEnabled.value = value
  void api.saveMinimapVisionDebugEnabled(value)
}

function setMinimapVisionOverlayEnabled(value: boolean) {
  minimapVisionOverlayEnabled.value = value
  void api.saveMinimapVisionDebugOverlayEnabled(value)
}

async function toggleMinimapVisionOverlay() {
  await api.toggleMinimapVisionDebugOverlay()
}

async function resetMinimapVisionOverlayPosition() {
  await api.resetMinimapVisionDebugPosition()
}

async function toggleTempoOverlay() {
  tempoOverlay.value = await api.toggleTempoOverlay()
}

async function resetTempoOverlayPosition() {
  tempoOverlay.value = await api.resetTempoOverlayPosition()
}

async function loadTrust(check = false) {
  trustBusy.value = true
  try {
    trust.value = check ? await api.checkDataTrust() : await api.getDataTrust()
  } finally {
    trustBusy.value = false
  }
}

async function createBackup() {
  trustBusy.value = true
  try {
    await api.createBackup()
  } finally {
    trustBusy.value = false
  }
}

async function deleteBackup(fileName: string) {
  if (!window.confirm("Delete this database backup? This cannot be undone.")) return
  await api.deleteBackup(fileName)
}

async function restoreBackup(fileName: string) {
  if (!window.confirm("Inspect and restore this verified backup?")) return
  if (!window.confirm(
    "Recall will create a pre-restore backup, replace the active database, and restart. Continue?",
  )) return
  await api.restoreBackup(fileName)
}

const bytes = (value?: number) => {
  if (!value) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const power = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`
}

async function saveRiotKey() {
  riotKeyMessage.value = ""
  try {
    await api.saveRiotApiKey(riotApiKey.value)
    riotApiKey.value = ""
    riotKeyConfigured.value = true
    riotKeyMessage.value = props.connected
      ? "API key saved. Choose Enrich historical details to start an explicit import."
      : "API key saved. Open and sign in to the League client before starting an import."
  } catch (error) {
    riotKeyMessage.value = (error as Error).message
  }
}

async function clearRiotKey() {
  await api.clearRiotApiKey()
  riotApiKey.value = ""
  riotKeyConfigured.value = false
  if (riotHistory.value?.status === "running") {
    riotHistory.value = { ...riotHistory.value, status: "paused" }
  }
  riotKeyMessage.value = "API key removed from this device."
}

function retryRiotHistory() {
  void api.retryRiotHistory()
}

function reimportRiotDetails() {
  riotKeyMessage.value =
    "Scanning full Match-V5 history beyond the League client's latest 20 games…"
  void api.reimportRiotDetails()
}

const historyImportAction = computed(() => {
  if (riotHistory.value?.status === "running") return "Importing full history…"
  if (riotHistory.value) return "Re-scan full history"
  return "Import older matches"
})

function runUpdateAction(command: "retry" | "install") {
  if (command === "retry") void api.retryUpdate()
  else if (command === "install") emit("install-update")
}

async function checkForApplicationUpdates() {
  updateStatus.value = { kind: "checking" }
  try {
    await api.checkForUpdates()
    updateStatus.value = await api.getUpdateStatus()
  } catch {
    updateStatus.value = {
      kind: "error",
      message: "Could not check for updates. Recall is still ready to use.",
    }
  }
}

async function resync() {
  busy.value = true
  message.value = ""
  try {
    const result = await api.syncNow()
    message.value =
      result.inserted > 0
        ? `Recorded ${result.inserted} new game${result.inserted === 1 ? "" : "s"}.`
        : "Already up to date."
    await Promise.all([loadMeta(), loadRecall(), refreshTrust()])
  } finally {
    busy.value = false
  }
}

async function exportHistory() {
  busy.value = true
  message.value = ""
  try {
    const result = await api.exportHistory()
    message.value = result.filePath
      ? `Exported ${result.exported} matches.`
      : "Export cancelled."
  } finally {
    busy.value = false
  }
}

async function createFullBackup() {
  busy.value = true
  message.value = ""
  try {
    const result = await api.createFullBackup()
    message.value = result.created ? "Created a lossless full Recall backup." : "Backup cancelled."
  } finally {
    busy.value = false
  }
}

async function clearHistory() {
  busy.value = true
  message.value = ""
  try {
    const result = await api.clearHistory()
    message.value =
      result.deleted > 0
        ? `Deleted ${result.deleted} recorded matches.`
        : "Nothing was deleted."
    await Promise.all([loadMeta(), loadRecall()])
  } finally {
    busy.value = false
  }
}

const formatDate = (value?: number) =>
  value ? new Date(value).toLocaleString() : "—"
</script>

<template>
  <div class="page">
    <PageHeader
      title="Settings"
      eyebrow="Recall configuration"
      description="Control how Recall starts, stores data, and connects to optional services."
    />

    <UiTabs
      v-model="settingsTab"
      :options="settingsTabs"
      label="Settings categories"
      variant="compact"
    />

    <Panel
      v-if="['general', 'gameplay', 'development'].includes(settingsTab)"
      :title="settingsPanelTitle"
    >

      <label v-show="settingsTab === 'general'" class="setting">
        <input
          type="checkbox"
          :checked="props.isColoredWhenDone"
          @change="
            emit(
              'update:isColoredWhenDone',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        <span>
          Grey out completed champions
          <span class="muted hint">
            Otherwise incomplete champions are greyed instead.
          </span>
        </span>
      </label>

      <label v-show="settingsTab === 'general'" class="setting">
        <input
          type="checkbox"
          :checked="props.showChampionNames"
          @change="
            emit(
              'update:showChampionNames',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        <span>Show champion names under icons</span>
      </label>

      <label v-show="settingsTab === 'general'" class="setting">
        <input type="checkbox" :checked="launchAtLogin"
          @change="setLaunchAtLogin(($event.target as HTMLInputElement).checked)" />
        <span>
          Start Recall with Windows
          <span class="muted hint">Opens hidden in the notification area so game recording is ready.</span>
        </span>
      </label>

      <label v-show="settingsTab === 'gameplay'" class="setting">
        <input type="checkbox" :checked="minimapTelemetryEnabled"
          @change="setMinimapTelemetryEnabled(($event.target as HTMLInputElement).checked)" />
        <span>
          Track minimap movement and jungle clears
          <span class="muted hint">
            Requires Advanced jungle timers in League's Interface settings. Recall processes the game window
            locally and normally stores only confirmed points and timings.
          </span>
        </span>
      </label>

      <label v-if="isDevelopment && settingsTab === 'development'" class="setting">
        <input type="checkbox" :checked="minimapVisionDebugEnabled"
          :disabled="!minimapTelemetryEnabled"
          @change="setMinimapVisionDebugEnabled(($event.target as HTMLInputElement).checked)" />
        <span>
          Keep temporary minimap vision samples
          <span class="muted hint">
            Saves bounded minimap-only crops and detection overlays for detector tuning, including
            Practice Tool sessions. It never saves the full game window.
          </span>
        </span>
      </label>

      <label v-if="isDevelopment && settingsTab === 'development'" class="setting">
        <input type="checkbox" :checked="minimapVisionOverlayEnabled"
          :disabled="!minimapTelemetryEnabled"
          @change="setMinimapVisionOverlayEnabled(($event.target as HTMLInputElement).checked)" />
        <span>
          Enable minimap CV debug overlay
          <span class="muted hint">
            Opt-in, click-through diagnostics showing only the bounded minimap ROI, calibration, detections, and camp states.
            It never displays the full desktop.
          </span>
        </span>
      </label>

      <div
        v-if="isDevelopment && settingsTab === 'development' && minimapVisionOverlayEnabled"
        class="tempo-overlay-setting"
      >
        <div>
          <strong>Minimap CV debug window</strong>
          <span class="muted hint">Place it once, then lock it so League input passes through.</span>
        </div>
        <div class="actions">
          <UiButton type="button" @click="toggleMinimapVisionOverlay">Show / hide</UiButton>
          <UiButton type="button" variant="ghost" @click="resetMinimapVisionOverlayPosition">Reset position</UiButton>
        </div>
      </div>

      <div v-show="settingsTab === 'general'" class="timezone-setting">
        <UiField label="Display timezone" compact>
          <input
            v-model="displayTimezone"
            class="league-input"
            placeholder="America/Chicago"
            @keyup.enter="saveTimezone"
          />
        </UiField>
        <div class="actions">
          <UiButton type="button" @click="saveTimezone">Save timezone</UiButton>
          <UiButton type="button" variant="ghost" @click="useSystemTimezone">
            Use system timezone
          </UiButton>
        </div>
        <span class="muted hint">Current: {{ resolvedTimezone }}</span>
        <span v-if="timezoneMessage" class="muted hint">{{ timezoneMessage }}</span>
      </div>

      <div v-show="settingsTab === 'gameplay'" class="tempo-overlay-setting">
        <div>
          <strong>In-game Tempo overlay</strong>
          <span class="muted hint">
            {{ tempoOverlay.shortcutRegistered
              ? "Press Alt+T from anywhere to show or hide the dial. Use Borderless mode in League."
              : "Alt+T is unavailable because another app owns it. Use this button or the tray menu instead." }}
          </span>
          <span v-if="tempoOverlay.visible" class="muted hint">
            {{ tempoOverlay.locked
              ? "Visible and click-through. Press Alt+T twice to reopen it for placement."
              : "Visible in placement mode. Drag its bezel, then choose Lock on the overlay." }}
          </span>
        </div>
        <div class="actions">
          <UiButton type="button" @click="toggleTempoOverlay">
            {{ tempoOverlay.visible ? "Hide overlay" : "Show overlay" }}
          </UiButton>
          <UiButton type="button" variant="ghost" @click="resetTempoOverlayPosition">
            Reset position
          </UiButton>
        </div>
      </div>
    </Panel>

    <Panel v-show="settingsTab === 'general'" title="Application updates">
      <p class="muted note">{{ update.message }}</p>
      <div class="actions update-actions">
        <UiButton
          type="button"
          :disabled="updateStatus.kind === 'checking'"
          @click="checkForApplicationUpdates"
        >
          {{ updateStatus.kind === "checking" ? "Checking…" : "Check for updates" }}
        </UiButton>
        <UiButton
          v-if="update.action"
          variant="primary"
          @click="runUpdateAction(update.action!.command)"
        >
          {{ update.action!.label }}
        </UiButton>
        <UiButton
          variant="ghost"
          type="button"
          @click="emit('view-patch-notes')"
        >
          View patch notes
        </UiButton>
      </div>
    </Panel>

    <Panel v-show="settingsTab === 'riot-history'" title="Riot API" class="riot-panel">
      <p class="muted note">
        Used only to resolve the signed-in Riot ID and run the full Match-V5
        history import you start here. Normal post-game details, scoreboards, and
        recent timelines come directly from the connected League client without a
        developer key. The key is encrypted by your operating system and is never
        shown again.
      </p>
      <p class="muted note">
        Paste the Web API key beginning with <code>RGAPI-</code>. An RSO client
        secret or access token cannot be used for Match-V5.
      </p>
      <Surface as="div" variant="inset" padding="compact" class="portal-callout">
        <div>
          <strong>Need a Riot API key?</strong>
          <span>
            Sign in to Riot's Developer Portal to generate a development key.
            Development keys expire every 24 hours, so you may need to regenerate
            and replace it here. Recall only stores the key on this computer.
          </span>
        </div>
        <a
          class="portal-link"
          href="https://developer.riotgames.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open Riot Developer Portal <span aria-hidden="true">↗</span>
        </a>
      </Surface>
      <p v-if="!riotKeyProtected" class="muted note danger-note">
        Secure local storage is unavailable, so Recall will not save an API key on this computer.
      </p>
      <div class="key-row">
        <UiField label="Riot API key" compact class="api-key-field">
          <input
            v-model="riotApiKey"
            type="password"
            class="league-input"
            autocomplete="off"
            spellcheck="false"
            placeholder="Paste a regenerated Riot API key"
            :disabled="!riotKeyProtected"
            @keyup.enter="saveRiotKey"
          />
        </UiField>
        <UiButton variant="primary" :disabled="!riotApiKey || !riotKeyProtected" @click="saveRiotKey">
          {{ riotKeyConfigured ? "Replace key" : "Save key" }}
        </UiButton>
        <UiButton v-if="riotKeyConfigured" variant="danger" @click="clearRiotKey">Remove key</UiButton>
      </div>
      <p class="muted note">{{ riotKeyMessage || (riotKeyConfigured ? "A key is configured on this device." : "No API key configured.") }}</p>
      <p v-if="riotKeyConfigured" class="muted note" :class="{ 'danger-note': riotHistory?.status === 'error' }">
        {{ riotHistoryMessage }}
      </p>
      <div v-if="riotKeyConfigured && (riotHistory?.status === 'error' || riotHistory?.status === 'paused')" class="actions">
        <UiButton :disabled="!connected" @click="retryRiotHistory">
          Resume history import
        </UiButton>
      </div>
      <div v-if="riotKeyConfigured" class="actions">
        <UiButton
          :disabled="riotHistory?.status === 'running'"
          @click="reimportRiotDetails">
          {{ historyImportAction }}
        </UiButton>
      </div>
      <p v-if="riotKeyConfigured" class="muted note">
        Scans every Match‑V5 page Riot makes available—not only the League client's
        latest 20 games—and captures augments and other detailed fields. Progress is
        durable and resumes after restart.
      </p>
    </Panel>

    <Panel v-show="settingsTab === 'data'" title="Recorded data">

      <dl class="meta">
        <div>
          <dt>Matches recorded</dt>
          <dd class="numeric">{{ meta?.totalMatches ?? 0 }}</dd>
        </div>
        <div>
          <dt>Oldest match</dt>
          <dd>{{ formatDate(meta?.oldestPlayedAt) }}</dd>
        </div>
        <div class="path-row">
          <dt>Database</dt>
          <dd class="path">{{ meta?.databasePath }}</dd>
        </div>
      </dl>

      <p class="muted note">
        Recall keeps imported and newly played matches locally. The League client
        supplies its recent window; the optional developer key is only for importing
        older Match-V5 history from this Settings page.
      </p>

      <Surface as="div" variant="inset" padding="compact" class="performance-reference">
        <div>
          <strong>Comparison baseline</strong>
          <span>Each game mode freezes independently after enough complete games.</span>
          <div v-if="recall?.modeReferences.length" class="mode-references">
            <span v-for="reference in recall.modeReferences" :key="reference.mode">
              <strong>{{ modeLabel(reference.mode) }}</strong>
              <template v-if="reference.state === 'frozen'">
                {{ reference.referenceMatches }} reference games ·
                frozen {{ formatDate(reference.frozenAt) }}
                <template v-if="reference.newMatches"> · {{ reference.newMatches }} added since baseline</template>
              </template>
              <template v-else>
                {{ reference.eligibleMatches }}/{{ reference.requiredMatches }} games
              </template>
            </span>
          </div>
          <span>
            Every installation uses its own saved matches. Other players never use your baseline.
          </span>
          <span>
            Recalibrating an already-frozen mode uses up to 100 recent games. Its new baseline applies only to games played afterward.
          </span>
        </div>
        <UiButton
          variant="primary"
          :disabled="busy || rebuildingReference || (recall?.supportedScopes.length ?? 0) === 0"
          @click="rebuildPerformanceReference"
        >
          {{ rebuildingReference ? "Recalibrating…" : "Recalibrate all modes" }}
        </UiButton>
      </Surface>
      <p v-if="referenceMessage" class="muted note">{{ referenceMessage }}</p>

      <div class="actions">
        <UiButton :disabled="busy || !connected" @click="resync">
          Resync now
        </UiButton>
        <UiButton :disabled="busy" @click="exportHistory">
          Match summary CSV
        </UiButton>
        <UiButton :disabled="busy" @click="createFullBackup">
          Full Recall backup
        </UiButton>
        <UiButton
          variant="danger"
          :disabled="busy"
          @click="clearHistory"
        >
          Clear active history (recoverable)
        </UiButton>
      </div>

      <p v-if="message" class="muted note">{{ message }}</p>
    </Panel>

    <Panel v-show="settingsTab === 'data'" title="Data Trust Center" class="trust-center">
      <template #actions>
        <span class="trust-state" :class="trust?.state">
          {{ (trust?.state ?? "checking").replace("_", " ") }}
        </span>
        <UiButton size="compact" :disabled="trustBusy" @click="loadTrust(true)">
          {{ trustBusy ? "Checking…" : "Check now" }}
        </UiButton>
      </template>

      <div v-if="trust" class="trust-grid">
        <p class="muted note">
          {{ trust.clientHealth.status === "healthy" ? "Client data healthy" : "Client data needs attention" }}
          / Match-V5 history {{ trust.optionalHistory.status === "not_configured" ? "not configured" : trust.optionalHistory.status.replaceAll("_", " ") }}
        </p>
        <Surface as="article" variant="inset" padding="compact" class="trust-card">
          <h3>Local database</h3>
          <dl class="trust-list">
            <div><dt>Integrity</dt><dd>{{ trust.database.integrity }}</dd></div>
            <div><dt>Schema</dt><dd>v{{ trust.database.schemaVersion }}</dd></div>
            <div><dt>Size</dt><dd>{{ bytes(trust.database.sizeBytes) }}</dd></div>
            <div><dt>Matches</dt><dd>{{ trust.database.matchCount.toLocaleString() }}</dd></div>
            <div><dt>Full scoreboards</dt><dd>{{ trust.database.completeScoreboardPercent.toFixed(1) }}%</dd></div>
            <div><dt>Graded</dt><dd>{{ trust.database.gradedPercent.toFixed(1) }}%</dd></div>
            <div><dt>Timelines</dt><dd>{{ trust.database.timelineCount }}</dd></div>
            <div><dt>Capture manifests</dt><dd>{{ trust.database.captureManifestPercent.toFixed(1) }}%</dd></div>
            <div><dt>Augment matches</dt><dd>{{ trust.database.augmentMatchCount }}</dd></div>
            <div><dt>Schema drift</dt><dd>{{ trust.database.schemaDriftMatchCount }}</dd></div>
          </dl>
          <div v-if="trust.database.recovery" class="recovery-note">
            <strong>Recovered {{ formatDate(trust.database.recovery.recoveredAt) }}</strong>
            <span>
              Opened backup schema v{{ trust.database.recovery.sourceSchemaVersion }} and
              validated it at v{{ trust.database.recovery.targetSchemaVersion }}.
            </span>
            <span v-if="trust.database.recovery.skippedBackups">
              Skipped {{ trust.database.recovery.skippedBackups }} unusable backup(s).
            </span>
            <span class="path">Source: {{ trust.database.recovery.sourcePath }}</span>
            <span class="path">Original preserved: {{ trust.database.recovery.originalPath }}</span>
          </div>
          <p class="path">{{ trust.database.path }}</p>
        </Surface>

        <Surface as="article" variant="inset" padding="compact" class="trust-card">
          <h3>League client sync</h3>
          <dl class="trust-list">
            <div><dt>Client</dt><dd>{{ connected ? "Connected" : "Offline" }}</dd></div>
            <div><dt>First observed</dt><dd>{{ formatDate(trust.leagueClient.firstObservedAt) }}</dd></div>
            <div><dt>Last success</dt><dd>{{ formatDate(trust.leagueClient.lastSuccessAt) }}</dd></div>
            <div><dt>Latest inserted</dt><dd>{{ trust.leagueClient.itemsWritten }}</dd></div>
          </dl>
          <p v-if="trust.leagueClient.lastError" class="danger-note">{{ trust.leagueClient.lastError }}</p>
        </Surface>

        <Surface as="article" variant="inset" padding="compact" class="trust-card">
          <h3>Riot history</h3>
          <p class="muted">{{ trust.riotHistory.keyConfigured ? "Protected API key configured" : "Local only — no Riot key" }}</p>
          <dl class="trust-list">
            <div><dt>Route</dt><dd>{{ trust.riotHistory.route || "—" }}</dd></div>
            <div><dt>IDs scanned</dt><dd>{{ trust.riotHistory.coverage.idsScanned.toLocaleString() }}</dd></div>
            <div><dt>Downloaded</dt><dd>{{ trust.riotHistory.coverage.downloaded.toLocaleString() }}</dd></div>
            <div><dt>Imported</dt><dd>{{ trust.riotHistory.coverage.imported.toLocaleString() }}</dd></div>
            <div><dt>Skipped</dt><dd>{{ trust.riotHistory.coverage.skipped.toLocaleString() }}</dd></div>
          </dl>
          <p class="muted">
            {{ trust.riotHistory.coverage.status === "complete" && trust.riotHistory.coverage.through
              ? `Riot history complete through ${formatDate(trust.riotHistory.coverage.through)}`
              : trust.riotHistory.coverage.status === "running"
                ? "Historical import in progress"
                : trust.riotHistory.coverage.status === "needs_attention"
                  ? "Needs attention"
                  : `League-client history observed since ${formatDate(trust.riotHistory.coverage.firstObservedAt)}` }}
          </p>
          <div v-if="trust.riotHistory.rateLimits.length" class="rate-limits">
            <strong>Observed Riot rate limits</strong>
            <span v-for="window in trust.riotHistory.rateLimits"
              :key="`${window.limit}-${window.seconds}`">
              {{ window.used }}/{{ window.limit }} requests per {{ window.seconds }}s
            </span>
            <span v-if="trust.riotHistory.nextEligibleAt">
              Next eligible request: {{ formatDate(trust.riotHistory.nextEligibleAt) }}
            </span>
          </div>
        </Surface>

        <Surface as="article" variant="inset" padding="compact" class="trust-card backups">
          <div class="trust-head">
            <h3>Backups</h3>
            <UiButton size="compact" :disabled="trustBusy" @click="createBackup">Create backup</UiButton>
          </div>
          <EmptyState
            v-if="trust.backups.length === 0"
            compact
            title="No managed backups yet"
            description="Create a verified snapshot before making major data changes."
          />
          <div v-for="backup in trust.backups" :key="backup.fileName" class="backup-row">
            <div><strong>{{ backup.reason }}</strong>
              <span class="muted">{{ formatDate(backup.createdAt) }} · {{ backup.matchCount }} matches · {{ bytes(backup.sizeBytes) }} · {{ backup.integrity }}</span></div>
            <div class="actions">
              <UiButton size="compact" :disabled="backup.integrity !== 'ok'" @click="restoreBackup(backup.fileName)">Restore</UiButton>
              <UiButton size="compact" variant="danger" @click="deleteBackup(backup.fileName)">Delete</UiButton>
            </div>
          </div>
        </Surface>
      </div>
      <EmptyState
        v-else
        compact
        title="Checking local data"
        description="Recall is verifying database integrity and sync coverage."
      />
    </Panel>

    <Panel v-show="settingsTab === 'gameplay'" title="Challenge data">
      <div class="actions">
        <UiButton @click="emit('refetch')">
          Refresh challenges
        </UiButton>
        <UiButton @click="emit('refetch-aram-stats')">
          Refresh ARAM balance data
        </UiButton>
      </div>
    </Panel>

    <Panel v-show="settingsTab === 'general'" title="About Recall" variant="quiet">
      <p class="muted note">
        Recall is not endorsed by Riot Games and does not reflect the views or
        opinions of Riot Games or anyone officially involved in producing or
        managing Riot Games properties. Riot Games and all associated
        properties are trademarks or registered trademarks of Riot Games, Inc.
      </p>
    </Panel>
  </div>
</template>

<style scoped>
.performance-reference {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1rem 0;
}

.performance-reference > div {
  display: grid;
  gap: 0.3rem;
}

.performance-reference span {
  color: var(--text-muted);
  font-size: 0.88rem;
}

.mode-references {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
}

.mode-references > span {
  padding: 5px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  font-size: 11px;
}

.mode-references strong { color: var(--text-secondary); }

.page {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
  max-width: 1120px;
  container: recall-content / inline-size;
}

.setting {
  display: flex;
  align-items: flex-start;
  gap: var(--ui-space-3);
  padding: var(--ui-space-2) 0;
  font-size: 13px;
  cursor: pointer;
}

.setting input {
  margin-top: 3px;
  accent-color: var(--ui-accent-strong);
}

.hint {
  display: block;
  font-size: 11px;
}

.tempo-overlay-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-4);
  margin-top: var(--ui-space-3);
  padding-top: var(--ui-space-3);
  border-top: 1px solid var(--ui-divider);
}

.tempo-overlay-setting > div:first-child {
  display: grid;
  gap: 4px;
}

.tempo-overlay-setting strong {
  color: var(--ui-text-heading);
  font: 13px var(--ui-font-heading);
}

.meta {
  margin: 0 0 var(--space-3);
  display: grid;
  gap: var(--space-2);
  font-size: 13px;
}

.meta div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
}

.meta dt {
  color: var(--text-secondary);
}

.meta dd {
  margin: 0;
}

.path-row {
  flex-direction: column;
  gap: var(--space-1) !important;
}

.path {
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

.note {
  font-size: 12px;
  margin: var(--space-2) 0 0;
}

.actions {
  display: flex;
  gap: var(--ui-space-2);
  flex-wrap: wrap;
}

.update-actions {
  margin-top: var(--space-3);
}

.portal-callout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  margin-top: var(--ui-space-3);
  gap: var(--ui-space-3);
  border-color: color-mix(in srgb, var(--ui-live) 35%, transparent);
  background:
    radial-gradient(circle at 8% 0, color-mix(in srgb, var(--ui-live) 9%, transparent), transparent 48%),
    var(--ui-surface-inset);
}

.portal-callout > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.portal-callout strong {
  color: var(--ui-text-heading);
  font: 500 14px var(--ui-font-heading);
  letter-spacing: .35px;
}

.portal-callout span {
  max-width: 690px;
  color: var(--ui-text-subtle);
  font-size: 11px;
  line-height: 1.5;
}

.portal-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ui-space-2);
  min-height: var(--ui-control-height);
  padding: 6px var(--ui-space-3);
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-control-background);
  color: var(--ui-live);
  font: var(--ui-body-size) var(--ui-font-body);
  text-decoration: none;
  white-space: nowrap;
}

.portal-link:hover { border-color: var(--ui-control-border-hover); background: var(--ui-control-background-hover); }

.portal-link span { color: inherit; font-size: 12px; }

.key-row {
  display: flex;
  gap: var(--ui-space-2);
  align-items: end;
  margin-top: var(--ui-space-3);
}

.api-key-field { flex: 1; }

.league-input {
  min-width: 0;
  flex: 1;
  padding: var(--space-2) var(--space-3);
  color: var(--ui-text);
  background: var(--ui-control-background);
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  font: 12px var(--ui-font-body);
}

.league-input:focus { outline: none; border-color: var(--ui-border-emphasis); }
.danger-note { color: var(--ui-negative); }

@container recall-content (max-width: 620px) {
  .key-row { align-items: stretch; flex-direction: column; }
  .tempo-overlay-setting { align-items: stretch; flex-direction: column; }
  .portal-callout { grid-template-columns: 1fr; }
  .portal-link { width: 100%; }
}

.trust-center { max-width: 1080px; }
.trust-center :deep(.head) { flex-wrap: wrap; }
.trust-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.trust-head h3 { margin-bottom: 0; }
.trust-state { display: inline-block; margin-top: 4px; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; color: var(--ui-text-subtle); }
.trust-state.healthy { color: var(--ui-positive); }.trust-state.needs_attention { color: var(--ui-negative); }.trust-state.syncing { color: var(--ui-accent); }
.trust-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ui-space-3); margin-top: var(--ui-space-3); }
.trust-card { box-shadow: none; }
.trust-card h3 { margin: 0 0 var(--ui-space-2); font: 15px var(--ui-font-heading); color: var(--ui-text-heading); }
.trust-list { margin: 0; display: grid; gap: 4px; font-size: 11px; }.trust-list div { display: flex; justify-content: space-between; gap: var(--ui-space-2); }.trust-list dt { color: var(--ui-text-subtle); }.trust-list dd { margin: 0; text-align: right; }
.recovery-note { display: grid; gap: 3px; margin-top: var(--ui-space-3); padding: var(--ui-space-2); border: 1px solid color-mix(in srgb, var(--ui-positive) 35%, transparent); border-radius: var(--ui-radius-sm); color: var(--ui-text-subtle); font-size: 11px; }
.recovery-note strong { color: var(--ui-positive); }
.backups { grid-column: 1 / -1; }.backup-row { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-3); padding: var(--ui-space-2) 0; border-top: 1px solid var(--ui-divider); }.backup-row > div:first-child { display: flex; flex-direction: column; font-size: 11px; }
.rate-limits { display: grid; gap: 2px; margin-top: var(--ui-space-2); font-size: 12px; color: var(--ui-text-subtle); }
@container recall-content (max-width: 760px) { .trust-grid { grid-template-columns: 1fr; }.backups { grid-column: auto; }.backup-row { align-items: flex-start; flex-direction: column; } }
</style>
