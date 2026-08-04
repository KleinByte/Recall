<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faArrowLeft, faArrowRight } from "@fortawesome/free-solid-svg-icons"
import { api } from "../helpers/api"
import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
} from "../helpers/navigation"
import { useApiEvents } from "../helpers/use-api-events"
import RecallMark from "./RecallMark.vue"
import RecordNotificationCenter from "./RecordNotificationCenter.vue"
import type { RecordNotification } from "../types/notifications"

defineProps<{
  recordNotifications: RecordNotification[]
}>()

const emit = defineEmits<{
  (event: "mark-records-read"): void
  (event: "clear-records"): void
  (event: "open-record", gameId: number): void
}>()

const isMaximized = ref(false)
const events = useApiEvents()

function handleHistoryShortcut(event: KeyboardEvent) {
  if (!event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === "ArrowLeft" && canGoBack.value) {
    event.preventDefault()
    goBack()
  } else if (event.key === "ArrowRight" && canGoForward.value) {
    event.preventDefault()
    goForward()
  }
}

onMounted(async () => {
  window.addEventListener("keydown", handleHistoryShortcut)
  isMaximized.value = await api.isWindowMaximized()
  events.on("window:maximized", (value: boolean) => {
    isMaximized.value = value
  })
})

onBeforeUnmount(() => window.removeEventListener("keydown", handleHistoryShortcut))
</script>

<template>
  <header class="window-titlebar" @dblclick="api.toggleMaximizeWindow()">
    <div class="titlebar-left">
      <div class="titlebar-brand" aria-label="Recall">
        <RecallMark animated class="titlebar-mark" />
      </div>

      <nav class="history-controls" aria-label="Page history" @dblclick.stop>
        <button
          type="button"
          :disabled="!canGoBack"
          aria-label="Go back to the previous page"
          title="Back (Alt+Left)"
          @click="goBack"
        >
          <FontAwesomeIcon :icon="faArrowLeft" aria-hidden="true" />
        </button>
        <button
          type="button"
          :disabled="!canGoForward"
          aria-label="Go forward to the next page"
          title="Forward (Alt+Right)"
          @click="goForward"
        >
          <FontAwesomeIcon :icon="faArrowRight" aria-hidden="true" />
        </button>
      </nav>
    </div>

    <div class="titlebar-right">
      <RecordNotificationCenter
        :notifications="recordNotifications"
        @mark-read="emit('mark-records-read')"
        @clear="emit('clear-records')"
        @open-record="emit('open-record', $event)"
      />

      <div class="window-controls" @dblclick.stop>
        <button
          class="window-control"
          type="button"
          aria-label="Minimize Recall"
          title="Minimize"
          @click="api.minimizeWindow()"
        >
          <span class="minimize-icon" aria-hidden="true" />
        </button>
        <button
          class="window-control"
          type="button"
          :aria-label="isMaximized ? 'Restore Recall' : 'Maximize Recall'"
          :title="isMaximized ? 'Restore' : 'Maximize'"
          @click="api.toggleMaximizeWindow()"
        >
          <span
            class="maximize-icon"
            :class="{ restore: isMaximized }"
            aria-hidden="true"
          />
        </button>
        <button
          class="window-control close-control"
          type="button"
          aria-label="Close Recall to the notification area"
          title="Close"
          @click="api.closeWindow()"
        >
          <span class="close-icon" aria-hidden="true" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.window-titlebar {
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;
  height: 38px;
  flex: 0 0 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 10px;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--ui-accent) 5.5%, transparent),
      transparent 28%
    ),
    var(--ui-shell);
  border-bottom: 1px solid var(--ui-divider);
  box-shadow: 0 1px 10px color-mix(in srgb, var(--ui-canvas) 62%, transparent);
  user-select: none;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 100%;
}

.titlebar-left {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 100%;
}

.history-controls {
  -webkit-app-region: no-drag;
  display: flex;
  gap: 3px;
  margin-left: 14px;
}

.history-controls button {
  width: 30px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-subtle);
  font-size: 11px;
  cursor: pointer;
}

.history-controls button:hover:not(:disabled) {
  border-color: var(--ui-border-emphasis);
  background: var(--ui-surface-selected);
  color: var(--ui-text-heading);
}

.history-controls button:focus-visible {
  outline: 2px solid var(--ui-focus-ring);
  outline-offset: 1px;
  box-shadow: var(--ui-shadow-focus);
}

.history-controls button:disabled {
  opacity: 0.28;
  cursor: default;
}

.titlebar-mark {
  width: 34px;
  height: 34px;
  margin-left: -4px;
  filter:
    drop-shadow(0 0 4px color-mix(in srgb, var(--ui-accent-strong) 18%, transparent))
    drop-shadow(0 0 6px color-mix(in srgb, var(--ui-live) 14%, transparent));
}

.window-controls {
  -webkit-app-region: no-drag;
  height: 100%;
  display: flex;
}

.titlebar-right {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 5px;
}

.window-control {
  position: relative;
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-left: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--ui-text-subtle);
  cursor: default;
  transition: background 0.1s ease, color 0.1s ease;
}

.window-control:hover {
  background: var(--ui-surface-selected);
  color: var(--ui-text-heading);
}

.window-control:focus-visible {
  z-index: 1;
  outline: 2px solid var(--ui-focus-ring);
  outline-offset: -2px;
  box-shadow: inset var(--ui-shadow-focus);
}

.close-control:hover {
  background: var(--ui-negative);
  color: var(--ui-text-heading);
}

.minimize-icon {
  width: 10px;
  height: 1px;
  background: currentColor;
}

.maximize-icon {
  position: relative;
  width: 10px;
  height: 10px;
  border: 1px solid currentColor;
}

.maximize-icon.restore::before {
  content: "";
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid currentColor;
  top: -2px;
  right: -2px;
  background: var(--ui-shell);
}

.maximize-icon.restore::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 8px;
  left: -2px;
  bottom: -2px;
  border: 1px solid currentColor;
  background: var(--ui-shell);
}

.close-icon,
.close-icon::after {
  width: 12px;
  height: 1px;
  background: currentColor;
  transform: rotate(45deg);
}

.close-icon {
  position: relative;
}

.close-icon::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: rotate(90deg);
}
</style>
