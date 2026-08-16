<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from "vue"

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  label: string
  width?: number
}>(), {
  width: 320,
})

const anchor = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const open = ref(false)
const left = ref(12)
const top = ref(12)
const side = ref<"above" | "below">("below")
const popupId = `hover-card-${useId().replaceAll(":", "")}`
let closeTimer: ReturnType<typeof setTimeout> | undefined

function clearCloseTimer() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = undefined
}

function positionPanel() {
  if (!anchor.value || !panel.value || typeof window === "undefined") return
  const trigger = anchor.value.getBoundingClientRect()
  const popup = panel.value.getBoundingClientRect()
  const margin = 12
  const gap = 10
  const popupWidth = popup.width || props.width
  const popupHeight = popup.height
  const centered = trigger.left + trigger.width / 2 - popupWidth / 2
  left.value = Math.max(margin, Math.min(centered, window.innerWidth - popupWidth - margin))

  const roomBelow = window.innerHeight - trigger.bottom
  side.value = roomBelow >= popupHeight + gap + margin || trigger.top < popupHeight + gap + margin
    ? "below"
    : "above"
  top.value = side.value === "below"
    ? trigger.bottom + gap
    : Math.max(margin, trigger.top - popupHeight - gap)
}

function listen() {
  window.addEventListener("resize", positionPanel)
  window.addEventListener("scroll", positionPanel, true)
}

function unlisten() {
  if (typeof window === "undefined") return
  window.removeEventListener("resize", positionPanel)
  window.removeEventListener("scroll", positionPanel, true)
}

async function show() {
  clearCloseTimer()
  if (!open.value) {
    open.value = true
    listen()
  }
  await nextTick()
  positionPanel()
}

function hide() {
  clearCloseTimer()
  open.value = false
  unlisten()
}

function scheduleHide() {
  clearCloseTimer()
  closeTimer = setTimeout(hide, 90)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") hide()
}

onBeforeUnmount(() => {
  clearCloseTimer()
  unlisten()
})
</script>

<template>
  <span
    ref="anchor"
    class="hover-card-anchor"
    v-bind="$attrs"
    tabindex="0"
    :aria-label="label"
    :aria-describedby="popupId"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focus="show"
    @blur="scheduleHide"
    @keydown="onKeydown"
  >
    <slot />
  </span>

  <Teleport to="body">
    <Transition name="hover-card">
      <aside
        v-if="open"
        :id="popupId"
        ref="panel"
        class="hover-card-panel"
        :class="`is-${side}`"
        role="tooltip"
        :style="{ left: `${left}px`, top: `${top}px`, '--hover-card-width': `${width}px` }"
        @mouseenter="clearCloseTimer"
        @mouseleave="scheduleHide"
      >
        <slot name="content" />
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.hover-card-anchor {
  display: inline-flex;
  min-width: 0;
  outline: none;
}

.hover-card-anchor:focus-visible {
  border-radius: var(--ui-radius-sm);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 72%, transparent);
}

.hover-card-panel {
  position: fixed;
  z-index: 2400;
  width: min(var(--hover-card-width), calc(100vw - 24px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 44%, var(--ui-border));
  border-radius: var(--ui-radius-md);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--ui-accent) 6%, transparent), transparent 42%),
    var(--ui-surface-overlay);
  box-shadow: 0 18px 46px rgba(0, 0, 0, .48), inset 0 1px rgba(255, 255, 255, .035);
  color: var(--ui-text);
  pointer-events: auto;
}

.hover-card-panel::before {
  position: absolute;
  inset: 0;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 12%, transparent);
  border-radius: inherit;
  pointer-events: none;
  content: "";
}

.hover-card-enter-active,
.hover-card-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.hover-card-enter-from,
.hover-card-leave-to { opacity: 0; }
.hover-card-enter-from.is-below,
.hover-card-leave-to.is-below { transform: translateY(-4px); }
.hover-card-enter-from.is-above,
.hover-card-leave-to.is-above { transform: translateY(4px); }

@media (prefers-reduced-motion: reduce) {
  .hover-card-enter-active,
  .hover-card-leave-active { transition: none; }
}
</style>
