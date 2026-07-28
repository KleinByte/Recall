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

async function loadMeta() {
  meta.value = await api.getStatsMeta()
}

onMounted(() => {
  void loadMeta()
  api.on("stats:updated", () => void loadMeta())
  void api.getUpdateStatus().then((status) => { updateStatus.value = status })
  api.onUpdateStatus((status) => { updateStatus.value = status })
})

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
