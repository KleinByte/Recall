<script setup lang="ts">
defineProps<{
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "win" | "loss"
}>()
</script>

<template>
  <div class="stat-card">
    <div class="label">{{ label }}</div>
    <div class="value numeric" :class="tone ?? 'neutral'">{{ value }}</div>
    <div v-if="hint" class="hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.stat-card {
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.label {
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.value {
  font-size: 26px;
  line-height: 1.15;
  color: var(--text-primary);
}

.value.win {
  color: var(--win);
}

.value.loss {
  color: var(--loss);
}

.hint {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
