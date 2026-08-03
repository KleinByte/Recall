<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faArrowLeft, faArrowRight } from "@fortawesome/free-solid-svg-icons"
import { currentAppVersion } from "../data/patch-notes"
import { api } from "../helpers/api"
import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
} from "../helpers/navigation"
import { useApiEvents } from "../helpers/use-api-events"
import RecallMark from "./RecallMark.vue"

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
        <span class="titlebar-wordmark">RECALL</span>
        <span class="titlebar-divider" aria-hidden="true" />
        <span class="titlebar-version">v{{ currentAppVersion }}</span>
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
    linear-gradient(90deg, rgba(200, 170, 109, 0.055), transparent 28%),
    linear-gradient(180deg, #101b2e, #0b1527);
  border-bottom: 1px solid rgba(200, 170, 109, 0.18);
  box-shadow: 0 1px 10px rgba(0, 0, 0, 0.24);
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
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.history-controls button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: rgba(200, 170, 109, 0.08);
  color: var(--gold-bright);
}

.history-controls button:focus-visible {
  outline: 1px solid var(--cyan);
  outline-offset: 1px;
}

.history-controls button:disabled {
  opacity: 0.28;
  cursor: default;
}

.titlebar-mark {
  width: 34px;
  height: 34px;
  margin: 0 3px 0 -4px;
  filter:
    drop-shadow(0 0 4px rgba(240, 211, 116, 0.18))
    drop-shadow(0 0 6px rgba(10, 203, 230, 0.14));
}

.titlebar-wordmark {
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 1;
  letter-spacing: 1.45px;
  color: var(--gold-bright);
}

.titlebar-divider {
  width: 1px;
  height: 13px;
  margin: 0 9px 0 10px;
  background: var(--border-strong);
}

.titlebar-version {
  font-family: var(--font-body);
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.65px;
  color: var(--text-muted);
}

.window-controls {
  -webkit-app-region: no-drag;
  height: 100%;
  display: flex;
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
  color: var(--text-secondary);
  cursor: default;
  transition: background 0.1s ease, color 0.1s ease;
}

.window-control:hover {
  background: rgba(200, 170, 109, 0.1);
  color: var(--gold-bright);
}

.window-control:focus-visible {
  z-index: 1;
  outline: 1px solid var(--cyan);
  outline-offset: -2px;
}

.close-control:hover {
  background: #c42b3b;
  color: #fff;
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
  background: #0d182a;
}

.maximize-icon.restore::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 8px;
  left: -2px;
  bottom: -2px;
  border: 1px solid currentColor;
  background: #0d182a;
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
