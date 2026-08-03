<script setup lang="ts">
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import {
  faChartSimple,
  faDragon,
  faGear,
  faListUl,
  faTowerBroadcast,
  faBookOpen,
  faAnglesLeft,
  faAnglesRight,
  faRadiation,
  faRotate,
  faSeedling,
  faTrophy,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons"
import type { Summoner } from "../types/lol"
import type { PageId } from "../helpers/navigation"
import RecallMark from "./RecallMark.vue"

defineProps<{
  page: PageId
  connected: boolean
  summoner: Summoner | null
  refreshing: boolean
  refreshMessage: string | null
  collapsed: boolean
}>()

const emit = defineEmits<{
  (event: "update:page", value: PageId): void
  (event: "update:collapsed", value: boolean): void
  (event: "refresh"): void
}>()

const items: { id: PageId; label: string; icon: IconDefinition }[] = [
  { id: "dashboard", label: "Dashboard", icon: faChartSimple },
  { id: "live", label: "Live Game", icon: faTowerBroadcast },
  { id: "review", label: "Review", icon: faBookOpen },
  { id: "matches", label: "Matches", icon: faListUl },
  { id: "skill", label: "Skill", icon: faRadiation },
  { id: "progress", label: "Progress", icon: faSeedling },
  { id: "champions", label: "Champions", icon: faDragon },
  { id: "challenges", label: "Challenges", icon: faTrophy },
  { id: "settings", label: "Settings", icon: faGear },
]
</script>

<template>
  <nav class="sidebar" :class="{ collapsed }">
    <div class="brand">
      <div class="brand-row">
        <Transition name="brand-recall" mode="out-in">
          <div
            v-if="collapsed"
            key="collapsed-logo"
            class="brand-title brand-title-collapsed"
            aria-label="Recall"
          >
            <RecallMark animated class="brand-logo brand-logo-collapsed" />
          </div>
          <div
            v-else
            key="expanded-wordmark"
            class="brand-title brand-title-expanded"
            aria-label="Recall"
          >
            <RecallMark variant="letter" class="brand-logo" />
            <span class="brand-mark">ECALL</span>
          </div>
        </Transition>
        <button
          class="collapse-toggle"
          type="button"
          :aria-label="collapsed ? 'Expand navigation' : 'Collapse navigation'"
          :aria-expanded="!collapsed"
          :title="collapsed ? 'Expand navigation' : 'Collapse navigation'"
          @click="emit('update:collapsed', !collapsed)"
        >
          <FontAwesomeIcon :icon="collapsed ? faAnglesRight : faAnglesLeft" fixed-width />
        </button>
      </div>
      <Transition name="brand-subtitle">
        <span v-if="!collapsed" class="brand-name">League companion</span>
      </Transition>
    </div>

    <ul class="nav">
      <li v-for="item in items" :key="item.id">
        <button
          class="nav-item"
          :class="{ active: page === item.id }"
          :title="collapsed ? item.label : undefined"
          @click="emit('update:page', item.id)"
        >
          <FontAwesomeIcon :icon="item.icon" class="nav-icon" fixed-width />
          <span v-if="!collapsed">{{ item.label }}</span>
        </button>
      </li>
    </ul>

    <button
      class="refresh"
      :disabled="refreshing || !connected"
      :title="connected ? 'Refresh matches, challenges, profile, and ranked data' : 'Start League before refreshing'"
      :aria-label="refreshing ? 'Refreshing' : 'Refresh'"
      @click="emit('refresh')"
    >
      <FontAwesomeIcon :icon="faRotate" :class="{ spinning: refreshing }" fixed-width />
      <span v-if="!collapsed">{{ refreshing ? "Refreshing…" : "Refresh" }}</span>
    </button>
    <p v-if="refreshMessage && !collapsed" class="refresh-message" role="status">
      {{ refreshMessage }}
    </p>

    <div class="status">
      <div class="status-row">
        <span class="dot" :class="{ online: connected }" />
        <span v-if="!collapsed" class="status-text">
          {{ connected ? "Client connected" : "Client not detected" }}
        </span>
      </div>
      <div v-if="summoner && !collapsed" class="summoner">
        {{ summoner.gameName }}
        <span class="tag">#{{ summoner.tagLine }}</span>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex: 0 0 var(--sidebar-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg, rgba(200, 170, 109, 0.035), transparent 24%),
    var(--surface-1);
  border-right: 1px solid var(--border-subtle);
  padding: var(--space-5) var(--space-3) var(--space-3);
  box-sizing: border-box;
  transition: width 0.18s ease, flex-basis 0.18s ease, padding 0.18s ease;
}

.sidebar.collapsed {
  width: 68px;
  flex-basis: 68px;
  padding-inline: var(--space-2);
}

.brand {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-3);
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.brand-title {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
}

.brand-title-collapsed {
  justify-content: center;
}

.brand-logo {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  margin-right: -5px;
  filter:
    drop-shadow(0 0 5px rgba(240, 211, 116, 0.18))
    drop-shadow(0 0 7px rgba(10, 203, 230, 0.1));
}

.brand-logo-collapsed {
  width: 44px;
  height: 44px;
  flex-basis: 44px;
  margin: -4px 0;
  filter:
    drop-shadow(0 0 8px rgba(240, 211, 116, 0.2))
    drop-shadow(0 0 12px rgba(10, 203, 230, 0.22));
}

.brand-mark {
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: 2.1px;
  color: var(--gold);
  line-height: 1;
}

.brand-name {
  font-family: var(--font-heading);
  font-size: 11px;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.collapse-toggle {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.collapse-toggle:hover {
  border-color: var(--gold);
  color: var(--gold-bright);
}

.sidebar.collapsed .brand {
  align-items: center;
  padding-inline: 0;
}

.sidebar.collapsed .brand-row {
  flex-direction: column;
  gap: var(--space-2);
}

.brand-title-collapsed.brand-recall-enter-active {
  animation: recall-brand-arrive .54s cubic-bezier(.2, .78, .2, 1) both;
}

.brand-title-collapsed.brand-recall-leave-active {
  animation: recall-brand-depart .48s cubic-bezier(.55, .04, .8, .35) both;
}

.brand-title-expanded.brand-recall-enter-active {
  animation: wordmark-return .42s cubic-bezier(.2, .72, .2, 1) both;
}

.brand-title-expanded.brand-recall-leave-active {
  animation: wordmark-fold .22s ease-in both;
}

.brand-subtitle-enter-active { animation: subtitle-return .35s .18s ease both; }
.brand-subtitle-leave-active { animation: subtitle-leave .15s ease both; }

.nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
}

.nav li:last-child {
  margin-top: auto;
}

.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  font-family: var(--font-body);
  font-size: 13px;
  letter-spacing: 0.6px;
  text-align: left;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border: 1px solid transparent;
  border-left: 2px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding-inline: 0;
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--text-primary);
}

.nav-item.active {
  background: linear-gradient(90deg, var(--surface-3), var(--surface-2));
  border-color: var(--border-subtle);
  border-left-color: var(--gold);
  color: var(--gold-bright);
}

.nav-icon {
  font-size: 13px;
  opacity: 0.85;
}

.refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: 100%;
  margin: var(--space-3) 0 var(--space-2);
  padding: var(--space-2);
  background: linear-gradient(145deg, var(--surface-3), var(--surface-2));
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--gold-bright);
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 12px;
}

.refresh:hover:not(:disabled) {
  border-color: var(--gold);
}

.sidebar.collapsed .refresh {
  padding-inline: 0;
}

.refresh:disabled {
  cursor: not-allowed;
  color: var(--text-muted);
  opacity: 0.7;
}

.spinning {
  animation: spin 0.8s linear infinite;
}

.refresh-message {
  margin: 0 0 var(--space-2);
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes recall-brand-arrive {
  0% { opacity: 0; transform: translateY(26px) scale(.62); filter: blur(3px) brightness(1.8); }
  45% { opacity: 1; transform: translateY(-3px) scale(1.08); filter: blur(0) brightness(1.4); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: brightness(1); }
}

@keyframes recall-brand-depart {
  0% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0) brightness(1); }
  42% { opacity: 1; transform: translateY(-5px) scale(1.08); filter: blur(0) brightness(1.7); }
  100% { opacity: 0; transform: translateY(-42px) scale(.38); filter: blur(4px) brightness(2.2); }
}

@keyframes wordmark-return {
  0% { opacity: 0; transform: translateX(-18px) scaleX(.72); filter: blur(3px); }
  58% { opacity: 1; transform: translateX(2px) scaleX(1.03); filter: blur(0); }
  100% { opacity: 1; transform: none; }
}

@keyframes wordmark-fold {
  to { opacity: 0; transform: translateX(-12px) scaleX(.78); filter: blur(2px); }
}

@keyframes subtitle-return {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
}

@keyframes subtitle-leave {
  to { opacity: 0; transform: translateY(-4px); }
}

@media (prefers-reduced-motion: reduce) {
  .brand-title-collapsed.brand-recall-enter-active,
  .brand-title-collapsed.brand-recall-leave-active,
  .brand-title-expanded.brand-recall-enter-active,
  .brand-title-expanded.brand-recall-leave-active,
  .brand-subtitle-enter-active,
  .brand-subtitle-leave-active {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }
}

.status {
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-3) var(--space-2) var(--space-1);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.sidebar.collapsed .status-row {
  justify-content: center;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  flex: 0 0 auto;
}

.dot.online {
  background: var(--win);
  box-shadow: 0 0 6px var(--win);
}

.status-text {
  font-size: 11px;
  color: var(--text-secondary);
}

.summoner {
  margin-top: var(--space-1);
  padding-left: 15px;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag {
  color: var(--text-muted);
}
</style>
