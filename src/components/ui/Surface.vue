<script setup lang="ts">
withDefaults(defineProps<{
  as?: string
  variant?: "panel" | "quiet" | "toolbar" | "inset" | "raised" | "instrument"
  padding?: "none" | "compact" | "normal" | "roomy"
}>(), {
  as: "section",
  variant: "panel",
  padding: "normal",
})
</script>

<template>
  <component
    :is="as"
    class="ui-surface"
    :class="['variant-' + variant, 'padding-' + padding]"
  >
    <slot />
  </component>
</template>

<style scoped>
.ui-surface {
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-panel);
  box-shadow: var(--ui-shadow-panel);
}

.variant-quiet { background: var(--ui-surface-panel-quiet); box-shadow: none; }
.variant-toolbar {
  border-color: var(--ui-divider);
  background: var(--ui-surface-inset);
  box-shadow: var(--ui-shadow-inset);
}
.variant-inset {
  border-color: var(--ui-divider);
  background: var(--ui-surface-inset);
  box-shadow: var(--ui-shadow-inset);
}
.variant-raised {
  border-color: var(--ui-border-emphasis);
  background: var(--ui-surface-raised);
  box-shadow: var(--ui-shadow-raised);
}
.variant-instrument {
  border-color: var(--instrument-border-strong);
  border-radius: 0;
  background: var(--instrument-surface);
  box-shadow: var(--instrument-shadow-raised);
  clip-path: polygon(12px 0, calc(100% - 12px) 0, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 12px), 0 12px);
}

.padding-none { padding: 0; }
.padding-compact { padding: var(--ui-space-3); }
.padding-normal { padding: var(--ui-space-4); }
.padding-roomy { padding: var(--ui-space-5); }
</style>
