<script setup lang="ts">
defineProps<{
  label?: string
  readings: Array<{
    label: string
    value: string
    hint?: string
    tone?: "neutral" | "win" | "loss"
  }>
}>()
</script>

<template>
  <section class="telemetry-grid" :aria-label="label ?? 'Performance telemetry'">
    <div v-if="label" class="bank-label">{{ label }}</div>
    <dl class="readings">
      <div v-for="reading in readings" :key="reading.label" class="reading">
        <dt>{{ reading.label }}</dt>
        <dd class="numeric" :class="reading.tone ?? 'neutral'">{{ reading.value }}</dd>
        <span v-if="reading.hint" class="hint">{{ reading.hint }}</span>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.telemetry-grid {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-divider);
  box-shadow: var(--ui-shadow-inset);
}

.bank-label {
  padding: 5px 10px 4px;
  border-bottom: 1px solid var(--ui-divider);
  background: var(--ui-surface-inset);
  color: var(--ui-text-muted);
  font: 9px var(--ui-font-heading);
  letter-spacing: 1.7px;
  text-transform: uppercase;
}

.readings {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  background: var(--ui-surface-inset);
}

.reading {
  display: grid;
  align-content: center;
  min-width: 0;
  min-height: 68px;
  padding: 8px 11px 9px;
  border-right: 1px solid var(--ui-divider);
  border-bottom: 1px solid var(--ui-divider);
  background: var(--ui-surface-inset);
}

.reading dt {
  overflow: hidden;
  color: var(--ui-text-muted);
  font: 9px var(--ui-font-heading);
  letter-spacing: 1.1px;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.reading dd {
  margin: 1px 0 0;
  overflow: hidden;
  color: var(--ui-text);
  font-size: 19px;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reading dd.win { color: var(--ui-positive); }
.reading dd.loss { color: var(--ui-negative); }

.hint {
  overflow: hidden;
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .readings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
