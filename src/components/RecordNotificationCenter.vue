<script setup lang="ts">
import { computed, ref } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faBell } from "@fortawesome/free-solid-svg-icons"
import { formatRecordValue } from "../helpers/format"
import type { RecordNotification } from "../types/notifications"

const props = defineProps<{ notifications: RecordNotification[] }>()
const emit = defineEmits<{
  (event: "mark-read"): void
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
    <button
      class="notification-trigger"
      :class="{ unread: unread > 0, active: open }"
      type="button"
      :aria-label="unread ? `${unread} unread record notifications` : 'Record notifications'"
      :aria-expanded="open"
      title="Record notifications"
      @click="toggle"
    >
      <FontAwesomeIcon :icon="faBell" aria-hidden="true" />
      <span v-if="unread" class="unread-count">{{ unread > 9 ? "9+" : unread }}</span>
    </button>

    <Transition name="notification-panel">
      <section v-if="open" class="notification-panel" aria-label="Record notifications">
        <header>
          <div>
            <span class="eyebrow">Recall notifications</span>
            <strong>Personal records</strong>
          </div>
          <span v-if="notifications.length" class="notification-total">
            {{ notifications.length }} recent
          </span>
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

        <div v-else class="notification-empty">
          <FontAwesomeIcon :icon="faBell" aria-hidden="true" />
          <strong>No new records yet</strong>
          <span>Your next personal best will appear here.</span>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.notification-center { -webkit-app-region: no-drag; position: relative; display: grid; place-items: center; height: 100%; }
.notification-trigger { position: relative; display: grid; place-items: center; width: 38px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: border-color .15s ease, background .15s ease, color .15s ease, filter .15s ease; }
.notification-trigger:hover, .notification-trigger.active { border-color: var(--border-strong); background: rgba(200,170,109,.08); color: var(--gold-bright); }
.notification-trigger.unread { color: #75e7f3; filter: drop-shadow(0 0 7px rgba(10,203,230,.72)); animation: bell-arrival .55s ease-out both; }
.unread-count { position: absolute; top: 1px; right: 1px; min-width: 14px; height: 14px; padding: 0 3px; border: 1px solid #102337; border-radius: 999px; background: var(--loss); color: #fff; font: 700 10px/12px var(--font-numeric); text-align: center; }
.notification-panel { position: absolute; z-index: 400; top: calc(100% + 7px); right: -5px; width: min(380px, calc(100vw - 24px)); overflow: hidden; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: radial-gradient(circle at 90% 0%, rgba(10,203,230,.09), transparent 42%), var(--surface-2); box-shadow: 0 18px 48px rgba(0,0,0,.52); color: var(--text-primary); }
.notification-panel > header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: 13px 14px; border-bottom: 1px solid var(--border-subtle); background: rgba(255,255,255,.018); }
.notification-panel > header div { display: flex; flex-direction: column; gap: 2px; }
.notification-panel .eyebrow { color: var(--cyan); font-size: 11px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
.notification-panel header strong { color: var(--gold-bright); font: 14px var(--font-heading); }
.notification-total { color: var(--text-muted); font-size: 12px; }
.notification-list { display: grid; max-height: min(470px, 70vh); overflow-y: auto; }
.record-notification { display: grid; grid-template-columns: 17px minmax(0,1fr); gap: 9px; width: 100%; padding: 12px 14px; border: 0; border-bottom: 1px solid var(--border-subtle); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.record-notification:last-child { border-bottom: 0; }.record-notification:hover { background: rgba(200,170,109,.07); }
.record-glyph { color: var(--cyan); text-shadow: 0 0 9px rgba(10,203,230,.68); }
.record-copy { display: flex; flex-direction: column; min-width: 0; gap: 3px; }
.record-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.record-heading strong { color: var(--gold-bright); font-size: 12px; }.record-heading time { flex: 0 0 auto; color: var(--text-muted); font-size: 11px; }
.record-line, .record-more { overflow: hidden; color: var(--text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.record-more { color: var(--gold); }
.review-link { margin-top: 3px; color: var(--cyan); font-size: 11px; }
.notification-empty { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 30px 18px; color: var(--text-muted); text-align: center; font-size: 11px; }
.notification-empty svg { margin-bottom: 4px; color: var(--border-strong); font-size: 20px; }.notification-empty strong { color: var(--text-secondary); font-size: 12px; }
.notification-panel-enter-active, .notification-panel-leave-active { transition: opacity .16s ease, transform .16s ease; }.notification-panel-enter-from, .notification-panel-leave-to { opacity: 0; transform: translateY(-6px) scale(.985); }
@keyframes bell-arrival { 0% { transform: rotate(0); } 24% { transform: rotate(12deg); } 48% { transform: rotate(-10deg); } 72% { transform: rotate(6deg); } 100% { transform: rotate(0); } }
@media (prefers-reduced-motion: reduce) { .notification-trigger.unread { animation: none; }.notification-panel-enter-active, .notification-panel-leave-active { transition: none; } }
</style>
