<script setup lang="ts">
import { computed, ref } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faBell } from "@fortawesome/free-solid-svg-icons"
import { Button as UiButton, EmptyState, Surface } from "./ui"
import { formatRecordValue } from "../helpers/format"
import type { RecordNotification } from "../types/notifications"

const props = defineProps<{ notifications: RecordNotification[] }>()
const emit = defineEmits<{
  (event: "mark-read"): void
  (event: "clear"): void
  (event: "open-record", gameId: number): void
}>()

const open = ref(false)
const unread = computed(() => props.notifications.filter((entry) => !entry.read).length)

function toggle() {
  open.value = !open.value
  if (open.value && unread.value) emit("mark-read")
}

function openRecord(gameId: number) {
  open.value = false
  emit("open-record", gameId)
}

function timestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value)
}
</script>

<template>
  <div class="notification-center" @dblclick.stop>
    <UiButton
      class="notification-trigger"
      :class="{ unread: unread > 0 }"
      variant="ghost"
      size="compact"
      icon-only
      :active="open"
      :aria-label="unread ? `${unread} unread record notifications` : 'Record notifications'"
      :aria-expanded="open"
      title="Record notifications"
      @click="toggle"
    >
      <FontAwesomeIcon :icon="faBell" aria-hidden="true" />
      <span v-if="unread" class="unread-count">{{ unread > 9 ? "9+" : unread }}</span>
    </UiButton>

    <Transition name="notification-panel">
      <Surface
        v-if="open"
        as="section"
        variant="raised"
        padding="none"
        class="notification-panel"
        aria-label="Record notifications"
      >
        <header>
          <div>
            <span class="eyebrow">Recall notifications</span>
            <strong>Personal records</strong>
          </div>
          <div v-if="notifications.length" class="header-actions">
            <span class="notification-total">{{ notifications.length }} recent</span>
            <UiButton
              variant="ghost"
              size="compact"
              class="clear-notifications"
              aria-label="Clear all Recall notifications"
              @click="emit('clear')"
            >
              Clear
            </UiButton>
          </div>
        </header>

        <div v-if="notifications.length" class="notification-list">
          <button
            v-for="notification in notifications"
            :key="notification.id"
            class="record-notification"
            type="button"
            @click="openRecord(notification.gameId)"
          >
            <span class="record-glyph" aria-hidden="true">◆</span>
            <span class="record-copy">
              <span class="record-heading">
                <strong>
                  {{ notification.records.length === 1
                    ? "New personal record"
                    : `${notification.records.length} new personal records` }}
                </strong>
                <time :datetime="new Date(notification.createdAt).toISOString()">
                  {{ timestamp(notification.createdAt) }}
                </time>
              </span>
              <span
                v-for="record in notification.records.slice(0, 3)"
                :key="record.key"
                class="record-line"
              >
                {{ record.label }} · {{ formatRecordValue(record) }}
              </span>
              <span v-if="notification.records.length > 3" class="record-more">
                +{{ notification.records.length - 3 }} more
              </span>
              <span class="review-link">Open match review →</span>
            </span>
          </button>
        </div>

        <EmptyState
          v-else
          compact
          class="notification-empty"
          title="No new records yet"
          description="Your next personal best will appear here."
        >
          <template #icon><FontAwesomeIcon :icon="faBell" aria-hidden="true" /></template>
        </EmptyState>
      </Surface>
    </Transition>
  </div>
</template>

<style scoped>
.notification-center { -webkit-app-region: no-drag; position: relative; display: grid; place-items: center; height: 100%; }
.notification-trigger { position: relative; color: var(--ui-text-subtle); font-size: 13px; transition: filter .15s ease; }
.notification-trigger.unread { color: var(--ui-live); filter: drop-shadow(0 0 7px color-mix(in srgb, var(--ui-live) 72%, transparent)); animation: bell-arrival .55s ease-out both; }
.unread-count { position: absolute; top: 0; right: 0; min-width: 14px; height: 14px; padding: 0 3px; border: 1px solid var(--ui-canvas); border-radius: var(--ui-radius-pill); background: var(--ui-negative); color: var(--ui-text-on-status); font: 700 10px/12px var(--ui-font-numeric); text-align: center; }
.notification-panel { position: absolute; z-index: var(--ui-z-popover); top: calc(100% + 7px); right: -5px; width: min(380px, calc(100vw - 24px)); overflow: hidden; background: radial-gradient(circle at 90% 0%, color-mix(in srgb, var(--ui-live) 9%, transparent), transparent 42%), var(--ui-surface-raised); color: var(--ui-text); }
.notification-panel > header { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-3); padding: 13px 14px; border-bottom: 1px solid var(--ui-divider); background: var(--ui-surface-hover-subtle); }
.notification-panel > header div { display: flex; flex-direction: column; gap: 2px; }
.notification-panel > header .header-actions { align-items: flex-end; }
.notification-panel .eyebrow { color: var(--ui-live); font-size: 11px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
.notification-panel header strong { color: var(--ui-text-heading); font: 14px var(--ui-font-heading); }
.notification-total { color: var(--ui-text-muted); font-size: 12px; }
.clear-notifications { min-height: 24px; padding: 2px 7px; color: var(--ui-text-subtle); font-size: 11px; }
.notification-list { display: grid; max-height: min(470px, 70vh); overflow-y: auto; }
.record-notification { display: grid; grid-template-columns: 17px minmax(0,1fr); gap: 9px; width: 100%; padding: 12px 14px; border: 0; border-bottom: 1px solid var(--ui-divider); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.record-notification:last-child { border-bottom: 0; }.record-notification:hover { background: color-mix(in srgb, var(--ui-accent) 7%, transparent); }
.record-glyph { color: var(--ui-live); text-shadow: 0 0 9px color-mix(in srgb, var(--ui-live) 68%, transparent); }
.record-copy { display: flex; flex-direction: column; min-width: 0; gap: 3px; }
.record-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.record-heading strong { color: var(--ui-text-heading); font-size: 12px; }.record-heading time { flex: 0 0 auto; color: var(--ui-text-muted); font-size: 11px; }
.record-line, .record-more { overflow: hidden; color: var(--ui-text-subtle); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.record-more { color: var(--ui-accent); }
.review-link { margin-top: 3px; color: var(--ui-live); font-size: 11px; }
.notification-empty { margin: var(--ui-space-3); box-shadow: none; }
.notification-panel-enter-active, .notification-panel-leave-active { transition: opacity .16s ease, transform .16s ease; }.notification-panel-enter-from, .notification-panel-leave-to { opacity: 0; transform: translateY(-6px) scale(.985); }
@keyframes bell-arrival { 0% { transform: rotate(0); } 24% { transform: rotate(12deg); } 48% { transform: rotate(-10deg); } 72% { transform: rotate(6deg); } 100% { transform: rotate(0); } }
@media (prefers-reduced-motion: reduce) { .notification-trigger.unread { animation: none; }.notification-panel-enter-active, .notification-panel-leave-active { transition: none; } }
</style>
