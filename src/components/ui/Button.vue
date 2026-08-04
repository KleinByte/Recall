<script setup lang="ts">
withDefaults(defineProps<{
  type?: "button" | "submit" | "reset"
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "compact" | "normal"
  active?: boolean
  block?: boolean
  iconOnly?: boolean
}>(), {
  type: "button",
  variant: "secondary",
  size: "normal",
  active: false,
  block: false,
  iconOnly: false,
})
</script>

<template>
  <button
    :type="type"
    class="ui-button"
    :class="['variant-' + variant, 'size-' + size, { active, block, 'icon-only': iconOnly }]"
    :aria-pressed="active ? 'true' : undefined"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ui-space-2);
  min-height: var(--ui-control-height);
  padding: 6px var(--ui-space-3);
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-control-background);
  color: var(--ui-control-text);
  font: var(--ui-body-size) var(--ui-font-body);
  letter-spacing: .35px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.ui-button:hover:not(:disabled) {
  border-color: var(--ui-control-border-hover);
  background: var(--ui-control-background-hover);
  color: var(--ui-text-heading);
}
.ui-button:focus-visible {
  outline: 2px solid var(--ui-focus-ring);
  outline-offset: 2px;
  box-shadow: var(--ui-shadow-focus);
}
.ui-button:disabled { opacity: .46; cursor: not-allowed; }
.variant-primary, .active {
  border-color: var(--ui-border-emphasis);
  background: var(--ui-surface-selected);
  color: var(--ui-accent-strong);
}
.variant-ghost { border-color: transparent; background: transparent; color: var(--ui-text-subtle); }
.variant-danger { border-color: color-mix(in srgb, var(--ui-negative) 50%, transparent); color: var(--ui-negative-text); }
.variant-danger:hover:not(:disabled) { border-color: var(--ui-negative); background: color-mix(in srgb, var(--ui-negative) 12%, var(--ui-canvas)); }
.size-compact { min-height: var(--ui-control-height-compact); padding-block: 3px; font-size: 11px; }
.icon-only { width: var(--ui-control-height); padding-inline: 0; }
.size-compact.icon-only { width: var(--ui-control-height-compact); }
.block { width: 100%; }
</style>
