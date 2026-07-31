<script setup lang="ts">
import { ref } from "vue"
import { api } from "../helpers/api"
import type { UpdateStatus } from "../types/update"

defineProps<{
  status: UpdateStatus
}>()

const emit = defineEmits<{
  (event: "dismiss"): void
}>()

const installing = ref(false)

async function installUpdate() {
  installing.value = true
  try {
    await api.installUpdate()
  } finally {
    installing.value = false
  }
}
</script>

<template>
  <section v-if="status.kind === 'downloaded'" class="update-ready" role="status">
    <div class="body">
      <strong>Recall {{ status.version }} is ready to install.</strong>
      <span>The update will restart Recall and finish in the background.</span>
    </div>
    <button class="league-button" :disabled="installing" @click="installUpdate">
      {{ installing ? "Restarting…" : "Restart to update" }}
    </button>
    <button class="dismiss" title="Later" aria-label="Later" @click="emit('dismiss')">×</button>
  </section>
</template>

<style scoped>
.update-ready {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--gold);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.body strong {
  font-family: var(--font-heading);
  font-weight: 500;
  letter-spacing: 0.6px;
  color: var(--gold-bright);
}

.body span {
  color: var(--text-secondary);
  font-size: 12px;
}

.league-button {
  padding: var(--space-2) var(--space-3);
  white-space: nowrap;
}

.dismiss {
  padding: 0 var(--space-1);
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.dismiss:hover {
  color: var(--text-primary);
}
</style>