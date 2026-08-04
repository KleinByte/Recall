<script setup lang="ts">
export interface TabOption {
  value: string
  label: string
  disabled?: boolean
}

withDefaults(defineProps<{
  options: TabOption[]
  label: string
  variant?: "attached" | "compact"
}>(), { variant: "attached" })

const model = defineModel<string>({ required: true })
</script>

<template>
  <nav class="ui-tabs" :class="'variant-' + variant" role="tablist" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      :disabled="option.disabled"
      :class="{ active: model === option.value }"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
    <slot name="after" />
  </nav>
</template>

<style scoped>
.ui-tabs {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--ui-border);
  border-bottom-color: var(--ui-divider);
  border-radius: var(--ui-radius-md) var(--ui-radius-md) 0 0;
  background: var(--ui-surface-inset);
  scrollbar-width: none;
}
.ui-tabs::-webkit-scrollbar { display: none; }
.ui-tabs button {
  position: relative;
  flex: 0 0 auto;
  min-height: 39px;
  padding: 7px var(--ui-space-4);
  border: 0;
  border-right: 1px solid var(--ui-divider);
  background: transparent;
  color: var(--ui-text-muted);
  font: 11px var(--ui-font-heading);
  letter-spacing: 1.15px;
  text-transform: uppercase;
  cursor: pointer;
}
.ui-tabs button::after {
  content: "";
  position: absolute;
  inset: auto 9px 0;
  height: 2px;
  background: transparent;
}
.ui-tabs button:hover:not(:disabled) { color: var(--ui-text); background: var(--ui-surface-hover-subtle); }
.ui-tabs button.active { color: var(--ui-text-heading); background: var(--ui-surface-selected); }
.ui-tabs button.active::after { background: linear-gradient(90deg, transparent, var(--ui-accent-strong), transparent); }
.ui-tabs button:focus-visible { z-index: 1; outline: 2px solid var(--ui-focus-ring); outline-offset: -2px; }
.ui-tabs button:disabled { opacity: .42; cursor: not-allowed; }
.variant-compact { width: max-content; max-width: 100%; border-radius: var(--ui-radius-sm); }
.variant-compact button { min-height: var(--ui-control-height-compact); padding: 4px var(--ui-space-3); font-size: 10px; }

@media (max-width: 560px) {
  .ui-tabs:not(.variant-compact) button {
    flex: 1 1 0;
    min-width: 0;
    padding-inline: var(--ui-space-2);
    font-size: 10px;
    letter-spacing: .8px;
  }
}
</style>
