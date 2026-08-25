<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue"

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  labelledBy: string
  size?: "small" | "medium" | "large" | "wide" | "fullscreen"
  align?: "center" | "top"
  padding?: "none" | "normal"
}>(), {
  size: "medium",
  align: "center",
  padding: "normal",
})

const emit = defineEmits<{ (event: "close"): void }>()
const dialog = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault()
    emit("close")
    return
  }
  if (event.key !== "Tab" || !dialog.value) return

  const focusable = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true")

  if (!focusable.length) {
    event.preventDefault()
    dialog.value.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  document.addEventListener("keydown", handleKeydown)
  await nextTick()
  const initialFocus = dialog.value?.querySelector<HTMLElement>(
    `[autofocus], ${focusableSelector}`,
  )
  ;(initialFocus ?? dialog.value)?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown)
  previouslyFocused?.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="ui-dialog-backdrop" :class="'align-' + align" @click.self="emit('close')">
      <section
        v-bind="$attrs"
        ref="dialog"
        class="ui-dialog"
        :class="['size-' + size, 'padding-' + padding]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy"
        tabindex="-1"
      >
        <slot />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ui-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--ui-z-modal);
  display: flex;
  justify-content: center;
  overflow-y: auto;
  padding: var(--ui-space-5);
  background: color-mix(in srgb, var(--ui-canvas) 84%, transparent);
  backdrop-filter: blur(5px);
}
.align-center { align-items: center; }
.align-top { align-items: flex-start; padding-top: var(--ui-space-6); }
.ui-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(760px, calc(100vh - 40px));
  overflow: hidden;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface-raised);
  box-shadow: var(--ui-shadow-raised);
  color: var(--ui-text);
}
.ui-dialog:focus { outline: none; }
.size-small { max-width: 480px; }
.size-medium { max-width: 680px; }
.size-large { max-width: 860px; }
.size-wide { max-width: 980px; }
.size-fullscreen {
  width: calc(100vw - 32px);
  max-width: 1380px;
  height: calc(100vh - 32px);
  max-height: 960px;
}
.padding-none { padding: 0; }
.padding-normal { overflow-y: auto; padding: var(--ui-space-5); }
@media (max-width: 620px) {
  .ui-dialog-backdrop { align-items: stretch; padding: var(--ui-space-2); }
  .ui-dialog { max-height: calc(100vh - var(--ui-space-4)); border-radius: var(--ui-radius-md); }
  .padding-normal { padding: var(--ui-space-4); }
}
</style>
