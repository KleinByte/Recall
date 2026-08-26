<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Button as UiButton, Surface } from "./ui"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import type { RecoveryBackupSummary, StartupState } from "../types/recovery"
import type { UpdateStatus } from "../types/update"

const props = defineProps<{
  state: Exclude<StartupState, { kind: "ready" }>
}>()

const backups = ref<RecoveryBackupSummary[]>([])
const selectedId = ref<string>()
const externalName = ref<string>()
const loading = ref(true)
const busy = ref(false)
const error = ref<string>()
const updateStatus = ref<UpdateStatus>({ kind: "up-to-date" })
const events = useApiEvents()

const selected = computed(() => backups.value.find((backup) =>
  backup.id === selectedId.value))
const canRestore = computed(() => Boolean(
  externalName.value || selected.value?.status === "restorable",
))
const updateMessage = computed(() => {
  const status = updateStatus.value
  if (status.kind === "checking") return "Checking for a compatible Recall update…"
  if (status.kind === "available") return `Recall v${status.version} is available and downloading.`
  if (status.kind === "downloading") return `Downloading Recall v${status.version}: ${status.percent}%`
  if (status.kind === "downloaded") return `Recall v${status.version} is ready to install.`
  if (status.kind === "error") return status.message
  return "No newer Recall update is currently available."
})

function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

function date(value: number) {
  return new Date(value).toLocaleString()
}

async function loadBackups() {
  loading.value = true
  error.value = undefined
  try {
    backups.value = await api.listRecoveryBackups()
    selectedId.value = backups.value.find((backup) => backup.status === "restorable")?.id
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function browse() {
  const choice = await api.browseRecoveryBackup()
  if (!choice) return
  externalName.value = choice.fileName
  selectedId.value = choice.id
  error.value = undefined
}

async function restore() {
  if (!selectedId.value || busy.value || !canRestore.value) return
  busy.value = true
  error.value = undefined
  try {
    await api.restoreRecoveryBackup(selectedId.value)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    busy.value = false
  }
}

onMounted(() => {
  void loadBackups()
  void api.getUpdateStatus().then((status) => { updateStatus.value = status })
  events.onUpdateStatus((status) => { updateStatus.value = status })
})
</script>

<template>
  <main class="recovery-shell" aria-labelledby="recovery-title">
    <Surface variant="raised" padding="roomy" class="recovery-card">
      <div class="recovery-heading">
        <span class="signal" aria-hidden="true">R</span>
        <div>
          <p class="eyebrow">History recovery</p>
          <h1 id="recovery-title">Recall opened without your database</h1>
          <p>{{ state.message }}</p>
        </div>
      </div>

      <div v-if="state.kind === 'restoring' || busy" class="restoring" role="status">
        <span class="spinner" aria-hidden="true" />
        <div>
          <strong>Restoring safely</strong>
          <p>A copy is being validated and migrated. The current database remains untouched unless every check passes.</p>
        </div>
      </div>

      <template v-else>
        <p class="guidance">
          Choose a recovery point below. Recall checks integrity and schema compatibility first;
          the newest usable backup is selected automatically.
        </p>

        <div class="backup-list" role="radiogroup" aria-label="Available Recall backups">
          <p v-if="loading" class="muted" role="status">Checking backups…</p>
          <p v-else-if="backups.length === 0" class="muted">No backups were found in Recall’s backup folder.</p>
          <button
            v-for="backup in backups"
            :key="backup.id"
            type="button"
            class="backup-choice"
            :class="{ selected: selectedId === backup.id, unavailable: backup.status !== 'restorable' }"
            role="radio"
            :aria-checked="selectedId === backup.id"
            :disabled="backup.status !== 'restorable'"
            @click="externalName = undefined; selectedId = backup.id"
          >
            <span class="backup-main">
              <strong>{{ date(backup.createdAt) }}</strong>
              <span>{{ backup.matchCount ?? 0 }} matches · {{ bytes(backup.sizeBytes) }} · schema v{{ backup.schemaVersion ?? '?' }}</span>
            </span>
            <span class="status" :class="backup.status">
              {{ backup.status === "restorable" ? "Ready" : backup.status === "newer_schema" ? "Needs newer Recall" : "Unusable" }}
            </span>
          </button>
        </div>

        <p v-if="externalName" class="external-choice">
          Selected file: <strong>{{ externalName }}</strong>
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="state.reason === 'newer_schema'" class="update-note" role="status">
          {{ updateMessage }}
        </p>
        <p class="path">Active database left untouched at {{ state.databasePath }}</p>

        <div class="actions">
          <UiButton variant="primary" :disabled="!canRestore || busy" @click="restore">
            Restore selected backup
          </UiButton>
          <UiButton :disabled="busy" @click="browse">Browse for another backup…</UiButton>
          <UiButton
            v-if="state.reason === 'newer_schema' && updateStatus.kind === 'downloaded'"
            variant="primary"
            :disabled="busy"
            @click="api.installUpdate()"
          >
            Install Recall v{{ updateStatus.version }}
          </UiButton>
          <UiButton
            v-else-if="state.reason === 'newer_schema'"
            :disabled="busy || updateStatus.kind === 'checking' || updateStatus.kind === 'downloading'"
            @click="api.checkForUpdates()"
          >
            Check for updates
          </UiButton>
          <UiButton variant="ghost" :disabled="busy" @click="api.retryDatabaseStartup()">Retry</UiButton>
          <UiButton variant="danger" :disabled="busy" @click="api.quitRecovery()">Quit Recall</UiButton>
        </div>
      </template>
    </Surface>
  </main>
</template>

<style scoped>
.recovery-shell {
  display: grid;
  flex: 1;
  place-items: center;
  overflow: auto;
  padding: clamp(24px, 5vw, 72px);
  background:
    radial-gradient(circle at 72% 12%, var(--ui-page-ambient-energy), transparent 38%),
    radial-gradient(circle at 20% 0%, var(--ui-page-ambient-metal), transparent 34%),
    var(--ui-canvas);
}
.recovery-card { width: min(860px, 100%); }
.recovery-heading { display: flex; gap: var(--ui-space-4); align-items: flex-start; }
.signal {
  display: grid;
  width: 54px;
  height: 54px;
  flex: 0 0 54px;
  place-items: center;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: 50%;
  background: var(--ui-surface-selected);
  color: var(--ui-accent-strong);
  font: 700 24px var(--ui-font-display);
  box-shadow: var(--ui-shadow-focus);
}
.eyebrow { margin: 0 0 4px; color: var(--ui-accent); font-size: var(--ui-text-label); letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 0; color: var(--ui-text-heading); font: var(--ui-title-size) var(--ui-font-display); }
.recovery-heading p:last-child, .guidance, .restoring p { color: var(--ui-text-muted); }
.guidance { margin: var(--ui-space-5) 0 var(--ui-space-3); }
.backup-list { display: grid; gap: var(--ui-space-2); max-height: 330px; overflow: auto; }
.backup-choice {
  display: flex;
  justify-content: space-between;
  gap: var(--ui-space-3);
  padding: var(--ui-space-3);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
}
.backup-choice.selected { border-color: var(--ui-border-emphasis); background: var(--ui-surface-selected); }
.backup-choice.unavailable { opacity: .58; cursor: not-allowed; }
.backup-main { display: grid; gap: 4px; }
.backup-main span, .path, .muted { color: var(--ui-text-subtle); font-size: var(--ui-text-label); }
.status { align-self: center; color: var(--ui-text-subtle); white-space: nowrap; }
.status.restorable { color: var(--ui-positive-text); }
.external-choice { padding: var(--ui-space-3); border: 1px solid var(--ui-border-emphasis); border-radius: var(--ui-radius-sm); }
.error { padding: var(--ui-space-3); border-left: 3px solid var(--ui-negative); background: color-mix(in srgb, var(--ui-negative) 10%, transparent); color: var(--ui-negative-text); }
.update-note { padding: var(--ui-space-3); border-left: 3px solid var(--ui-accent); background: var(--ui-surface-inset); color: var(--ui-text-muted); }
.path { overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); margin-top: var(--ui-space-4); }
.restoring { display: flex; gap: var(--ui-space-3); align-items: center; margin-top: var(--ui-space-5); padding: var(--ui-space-4); background: var(--ui-surface-inset); }
.restoring p { margin-bottom: 0; }
.spinner { width: 28px; height: 28px; border: 2px solid var(--ui-border); border-top-color: var(--ui-accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
