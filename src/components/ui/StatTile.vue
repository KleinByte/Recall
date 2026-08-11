<script setup lang="ts">
defineProps<{
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "win" | "loss"
  density?: "compact" | "normal"
}>()
</script>

<template>
  <div class="tile" :class="density ?? 'normal'">
    <div class="label">{{ label }}</div>
    <div class="value numeric" :class="tone ?? 'neutral'">{{ value }}</div>
    <div v-if="hint" class="hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.tile {
  background: var(--ui-surface-inset);
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  padding: var(--ui-space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.label {
  font-family: var(--ui-font-heading);
  font-size: var(--ui-text-label);
  letter-spacing: .9px;
  text-transform: uppercase;
  color: var(--ui-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.value {
  font-size: 22px;
  line-height: 1.15;
  color: var(--ui-text);
}

.value.win {
  color: var(--ui-live);
}

.value.loss {
  color: var(--ui-negative);
}

.hint {
  font-size: var(--ui-text-support);
  color: var(--ui-text-muted);
}

.compact { padding: 8px 10px; }
.compact .value { font-size: 18px; }
</style>
