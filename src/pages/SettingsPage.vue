<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { api } from "../helpers/api"
import { updatePresentation } from "../helpers/update"
import type { UpdateStatus } from "../types/update"
import type { RiotHistoryBackfillState, StatsMeta } from "../types/stats"
import type { DataTrustReport } from "../types/review"

const props = defineProps<{
  isColoredWhenDone: boolean
  showChampionNames: boolean
  connected: boolean
}>()

const emit = defineEmits<{
  (event: "update:isColoredWhenDone", value: boolean): void
  (event: "update:showChampionNames", value: boolean): void
  (event: "refetch"): void
  (event: "refetch-aram-stats"): void
  (event: "view-patch-notes"): void
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

const riotHistoryMessage = computed(() => {
  const history = riotHistory.value
  if (!history) {
    return props.connected
      ? "Save a key to import the complete Match-V5 history available for this account."
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

onMounted(() => {
  void loadMeta()
  api.on("stats:updated", () => void loadMeta())
  void api.getUpdateStatus().then((status) => { updateStatus.value = status })
  api.onUpdateStatus((status) => { updateStatus.value = status })
  void api.getRiotApiKeyStatus().then((status) => {
    riotKeyConfigured.value = status.configured
    riotKeyProtected.value = status.protected
    riotHistory.value = status.history
  })
  api.on("riot-history:updated", (status: RiotHistoryBackfillState) => {
    riotHistory.value = status
  })
  void loadTrust()
  api.on("data-trust:updated", () => void loadTrust())
})

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
    await loadTrust()
  } finally {
    trustBusy.value = false
  }
}

async function deleteBackup(fileName: string) {
  if (!window.confirm("Delete this database backup? This cannot be undone.")) return
  await api.deleteBackup(fileName)
  await loadTrust()
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
      ? "API key saved. The full history import is starting in the background."
      : "API key saved. The import will start when the League client connects."
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
    "Re-importing historical match details for augments and newly supported fields…"
  void api.reimportRiotDetails()
}

function runUpdateAction(command: "retry" | "install") {
  if (command === "retry") void api.retryUpdate()
  else if (command === "install") void api.installUpdate()
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
    await loadMeta()
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

async function clearHistory() {
  busy.value = true
  message.value = ""
  try {
    const result = await api.clearHistory()
    message.value =
      result.deleted > 0
        ? `Deleted ${result.deleted} recorded matches.`
        : "Nothing was deleted."
    await loadMeta()
  } finally {
    busy.value = false
  }
}

const formatDate = (value?: number) =>
  value ? new Date(value).toLocaleString() : "—"
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>Settings</h1>
    </header>

    <section class="card">
      <h2 class="section-title">Display</h2>

      <label class="setting">
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

      <label class="setting">
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
    </section>

    <section class="card">
      <h2 class="section-title">Application updates</h2>
      <p class="muted note">{{ update.message }}</p>
      <div class="actions update-actions">
        <button
          v-if="update.action"
          class="league-button action"
          @click="runUpdateAction(update.action!.command)"
        >
          {{ update.action!.label }}
        </button>
        <button
          class="league-button action"
          type="button"
          @click="emit('view-patch-notes')"
        >
          View patch notes
        </button>
      </div>
    </section>

    <section class="card">
      <h2 class="section-title">Riot API</h2>
      <p class="muted note">
        Used for Match-V5 history and optional live teammate stats. After saving,
        Recall imports every match Riot still exposes for your account. The key
        is encrypted by your operating system and is never shown again.
      </p>
      <p class="muted note">
        Paste the Web API key beginning with <code>RGAPI-</code>. An RSO client
        secret or access token cannot be used for Match-V5.
      </p>
      <p v-if="!riotKeyProtected" class="muted note danger-note">
        Secure local storage is unavailable, so Recall will not save an API key on this computer.
      </p>
      <div class="key-row">
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
        <button class="league-button action" :disabled="!riotApiKey || !riotKeyProtected" @click="saveRiotKey">
          {{ riotKeyConfigured ? "Replace key" : "Save key" }}
        </button>
        <button v-if="riotKeyConfigured" class="league-button action danger" @click="clearRiotKey">Remove key</button>
      </div>
      <p class="muted note">{{ riotKeyMessage || (riotKeyConfigured ? "A key is configured on this device." : "No API key configured.") }}</p>
      <p v-if="riotKeyConfigured" class="muted note" :class="{ 'danger-note': riotHistory?.status === 'error' }">
        {{ riotHistoryMessage }}
      </p>
      <div v-if="riotKeyConfigured && (riotHistory?.status === 'error' || riotHistory?.status === 'paused')" class="actions">
        <button class="league-button action" :disabled="!connected" @click="retryRiotHistory">
          Resume history import
        </button>
      </div>
      <div v-if="riotKeyConfigured" class="actions">
        <button class="league-button action"
          :disabled="riotHistory?.status === 'running'"
          @click="reimportRiotDetails">
          Enrich historical details
        </button>
      </div>
      <p v-if="riotKeyConfigured" class="muted note">
        Replays Match‑V5 history through the shared rate limiter to capture augments
        and newly supported fields. Progress is durable and resumes after restart.
      </p>
    </section>

    <section class="card">
      <h2 class="section-title">Recorded data</h2>

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
        Recall keeps imported and newly played matches locally. Without a Riot
        API key, the League client fallback is limited to its most recent 20 games.
      </p>

      <div class="actions">
        <button class="league-button action" :disabled="busy || !connected" @click="resync">
          Resync now
        </button>
        <button class="league-button action" :disabled="busy" @click="exportHistory">
          Export JSON
        </button>
        <button
          class="league-button action danger"
          :disabled="busy"
          @click="clearHistory"
        >
          Clear history
        </button>
      </div>

      <p v-if="message" class="muted note">{{ message }}</p>
    </section>

    <section class="card trust-center">
      <div class="trust-head">
        <div>
          <h2 class="section-title">Data Trust Center</h2>
          <span class="trust-state" :class="trust?.state">
            {{ (trust?.state ?? "checking").replace("_", " ") }}
          </span>
        </div>
        <button class="league-button action" :disabled="trustBusy" @click="loadTrust(true)">
          {{ trustBusy ? "Checking…" : "Check now" }}
        </button>
      </div>

      <div v-if="trust" class="trust-grid">
        <article class="trust-card">
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
          <p class="path">{{ trust.database.path }}</p>
        </article>

        <article class="trust-card">
          <h3>League client sync</h3>
          <dl class="trust-list">
            <div><dt>Client</dt><dd>{{ connected ? "Connected" : "Offline" }}</dd></div>
            <div><dt>First observed</dt><dd>{{ formatDate(trust.leagueClient.firstObservedAt) }}</dd></div>
            <div><dt>Last success</dt><dd>{{ formatDate(trust.leagueClient.lastSuccessAt) }}</dd></div>
            <div><dt>Latest inserted</dt><dd>{{ trust.leagueClient.itemsWritten }}</dd></div>
          </dl>
          <p v-if="trust.leagueClient.lastError" class="danger-note">{{ trust.leagueClient.lastError }}</p>
        </article>

        <article class="trust-card">
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
        </article>

        <article class="trust-card backups">
          <div class="trust-head">
            <h3>Backups</h3>
            <button class="league-button mini" :disabled="trustBusy" @click="createBackup">Create backup</button>
          </div>
          <p v-if="trust.backups.length === 0" class="muted">No managed backups yet.</p>
          <div v-for="backup in trust.backups" :key="backup.fileName" class="backup-row">
            <div><strong>{{ backup.reason }}</strong>
              <span class="muted">{{ formatDate(backup.createdAt) }} · {{ backup.matchCount }} matches · {{ bytes(backup.sizeBytes) }} · {{ backup.integrity }}</span></div>
            <div class="actions">
              <button class="league-button mini" :disabled="backup.integrity !== 'ok'" @click="restoreBackup(backup.fileName)">Restore</button>
              <button class="league-button mini danger" @click="deleteBackup(backup.fileName)">Delete</button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="card">
      <h2 class="section-title">Challenge data</h2>
      <div class="actions">
        <button class="league-button action" @click="emit('refetch')">
          Refresh challenges
        </button>
        <button class="league-button action" @click="emit('refetch-aram-stats')">
          Refresh ARAM balance data
        </button>
      </div>
    </section>

    <section class="card">
      <h2 class="section-title">About Recall</h2>
      <p class="muted note">
        Recall is not endorsed by Riot Games and does not reflect the views or
        opinions of Riot Games or anyone officially involved in producing or
        managing Riot Games properties. Riot Games and all associated
        properties are trademarks or registered trademarks of Riot Games, Inc.
      </p>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 1120px;
}

h1 {
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: 1px;
  margin: 0;
  color: var(--gold-bright);
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.setting {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  font-size: 13px;
  cursor: pointer;
}

.setting input {
  margin-top: 3px;
  accent-color: var(--gold);
}

.hint {
  display: block;
  font-size: 11px;
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
  gap: var(--space-2);
  flex-wrap: wrap;
}

.update-actions {
  margin-top: var(--space-3);
}

.key-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-top: var(--space-3);
}

.league-input {
  min-width: 0;
  flex: 1;
  padding: var(--space-2) var(--space-3);
  color: var(--text-primary);
  background: var(--surface-0);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font: 12px var(--font-body);
}

.league-input:focus { outline: none; border-color: var(--gold); }
.danger-note { color: var(--loss); }

@media (max-width: 620px) {
  .key-row { align-items: stretch; flex-direction: column; }
}

.action {
  padding: var(--space-2) var(--space-4);
}

.action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.danger:not(:disabled):hover {
  border-color: var(--loss);
  color: var(--loss);
}

.trust-center { max-width: 1080px; }
.trust-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.trust-head h2, .trust-head h3 { margin-bottom: 0; }
.trust-state { display: inline-block; margin-top: 4px; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; color: var(--text-secondary); }
.trust-state.healthy { color: var(--win); }.trust-state.needs_attention { color: var(--loss); }.trust-state.syncing { color: var(--gold); }
.trust-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-3); }
.trust-card { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: var(--space-3); }
.trust-card h3 { margin: 0 0 var(--space-2); font: 15px var(--font-heading); color: var(--gold-bright); }
.trust-list { margin: 0; display: grid; gap: 4px; font-size: 11px; }.trust-list div { display: flex; justify-content: space-between; gap: var(--space-2); }.trust-list dt { color: var(--text-secondary); }.trust-list dd { margin: 0; text-align: right; }
.backups { grid-column: 1 / -1; }.backup-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--border-subtle); }.backup-row > div:first-child { display: flex; flex-direction: column; font-size: 11px; }
.rate-limits { display: grid; gap: 2px; margin-top: var(--space-2); font-size: 10px; color: var(--text-secondary); }
.mini { padding: 4px 8px; font-size: 10px; }
@media (max-width: 760px) { .trust-grid { grid-template-columns: 1fr; }.backups { grid-column: auto; }.backup-row { align-items: flex-start; flex-direction: column; } }
</style>
