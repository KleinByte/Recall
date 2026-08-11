<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  hint?: string
  error?: string
  compact?: boolean
}>(), {
  hint: undefined,
  error: undefined,
  compact: false,
})
</script>

<template>
  <label class="ui-field" :class="{ compact, invalid: !!error }">
    <span class="ui-field-label">{{ label }}</span>
    <slot />
    <span v-if="error" class="ui-field-message error">{{ error }}</span>
    <span v-else-if="hint" class="ui-field-message">{{ hint }}</span>
  </label>
</template>

<style scoped>
.ui-field { display: grid; align-content: start; gap: 5px; min-width: 0; }
.ui-field-label {
  color: var(--ui-text-muted);
  font: var(--ui-label-size) var(--ui-font-heading);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}
.ui-field :deep(input), .ui-field :deep(select), .ui-field :deep(textarea) { width: 100%; min-width: 0; }
.ui-field-message { color: var(--ui-text-muted); font-size: var(--ui-text-label); line-height: 1.4; }
.ui-field-message.error { color: var(--ui-negative); }
.invalid :deep(input), .invalid :deep(select), .invalid :deep(textarea) { border-color: var(--ui-negative); }
.compact { gap: 3px; }
</style>
