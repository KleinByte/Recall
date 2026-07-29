<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { api } from "../helpers/api"
import { updatePresentation } from "../helpers/update"
import type { UpdateStatus } from "../types/update"
import type { StatsMeta } from "../types/stats"

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
  })
})

async function saveRiotKey() {
  riotKeyMessage.value = ""
  try {
    await api.saveRiotApiKey(riotApiKey.value)
    riotApiKey.value = ""
    riotKeyConfigured.value = true
    riotKeyMessage.value = "API key saved securely on this device."
  } catch (error) {
    riotKeyMessage.value = (error as Error).message
  }
}

async function clearRiotKey() {
  await api.clearRiotApiKey()
  riotApiKey.value = ""
  riotKeyConfigured.value = false
  riotKeyMessage.value = "API key removed from this device."
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
    <header>
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
      <div v-if="update.action" class="actions">
        <button
          class="league-button action"
          @click="runUpdateAction(update.action!.command)"
        >
          {{ update.action!.label }}
        </button>
      </div>
    </section>

    <section class="card">
      <h2 class="section-title">Riot API</h2>
      <p class="muted note">
        Used for optional live teammate history. The key is encrypted by your operating system and is never shown again after saving.
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
        The League client only exposes its most recent 20 games, so the app
        records games as you play and keeps them here permanently.
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
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 720px;
}

h1 {
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: 1px;
  margin: 0;
  color: var(--gold-bright);
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
</style>
