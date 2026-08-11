<script setup lang="ts">
export type TelemetryReading = {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "win" | "loss"
}

export type TelemetryBank = {
  label: string
  readings: TelemetryReading[]
}

defineProps<{
  banks: TelemetryBank[]
  label?: string
}>()
</script>

<template>
  <section class="telemetry-board" :aria-label="label ?? 'Performance telemetry'">
    <section
      v-for="bank in banks"
      :key="bank.label"
      class="telemetry-bank"
      :style="{ '--bank-weight': Math.max(1, bank.readings.length), '--bank-columns': Math.max(1, bank.readings.length) }"
      :aria-label="`${bank.label} readings`"
    >
      <span class="bank-label">{{ bank.label }}</span>
      <dl class="readings">
        <div v-for="reading in bank.readings" :key="reading.label" class="reading">
          <dt>{{ reading.label }}</dt>
          <dd class="numeric" :class="reading.tone ?? 'neutral'">{{ reading.value }}</dd>
          <span v-if="reading.hint" class="hint">{{ reading.hint }}</span>
        </div>
      </dl>
    </section>
  </section>
</template>

<style scoped>
.telemetry-board {
  display: flex;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
  box-shadow: var(--ui-shadow-inset);
}

.telemetry-bank {
  position: relative;
  flex: var(--bank-weight) 1 0;
  min-width: 0;
  padding-top: 22px;
}

.telemetry-bank + .telemetry-bank {
  border-left: 1px solid var(--ui-divider);
}

.bank-label {
  position: absolute;
  inset: 0 0 auto;
  padding: 5px 10px 4px;
  border-bottom: 1px solid var(--ui-divider);
  color: var(--ui-text-muted);
  font: var(--ui-text-label) var(--ui-font-heading);
  letter-spacing: 1.1px;
  text-transform: uppercase;
}

.readings {
  display: grid;
  grid-template-columns: repeat(var(--bank-columns), minmax(0, 1fr));
  min-height: 62px;
  gap: 1px;
  margin: 0;
  background: var(--ui-divider);
}

.reading {
  display: grid;
  align-content: center;
  min-width: 0;
  padding: 8px 11px 9px;
  background: var(--ui-surface-inset);
}

.reading dt {
  overflow: hidden;
  color: var(--ui-text-muted);
  font: var(--ui-text-label) var(--ui-font-heading);
  letter-spacing: .8px;
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
  font-size: var(--ui-text-label);
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .telemetry-board { display: grid; grid-template-columns: minmax(0, 1fr); }
  .telemetry-bank + .telemetry-bank { border-top: 1px solid var(--ui-divider); border-left: 0; }
}

@media (max-width: 500px) {
  .readings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
