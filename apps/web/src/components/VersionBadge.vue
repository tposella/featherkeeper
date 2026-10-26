<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { dismissedVersion, dismissUpdate, loadVersion, versionInfo } from '../version.js';

// The version, next to the logo in the top bar, and the "update available" alert.

const open = ref(false);
const dismissed = ref(dismissedVersion());
const copied = ref(false);
const checking = ref(false);
const panel = ref(null);
const button = ref(null);

const update = computed(() => (versionInfo.admin && versionInfo.updateAvailable ? versionInfo.latest : null));
const alerting = computed(() => Boolean(update.value && update.value.version !== dismissed.value));
const label = computed(() => (versionInfo.current ? `v${versionInfo.current}` : ''));
const COMMAND = 'docker compose pull && docker compose up -d';

// Release notes are Markdown; show headings and bullet points as simple text blocks.
const notes = computed(() =>
  String(update.value?.notes ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, i, all) => line || (all[i - 1] && all[i - 1].trim()))
    .map((line) => {
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) return { kind: 'heading', text: h[1] };
      const b = line.match(/^\s*[-*]\s+(.*)$/);
      if (b) return { kind: 'bullet', text: b[1].replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1') };
      return { kind: 'text', text: line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1') };
    }),
);

function when(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    panel.value?.focus();
  }
}
function close() {
  open.value = false;
  button.value?.focus();
}
function notNow() {
  dismissUpdate(update.value.version);
  dismissed.value = update.value.version;
  close();
}
async function copy() {
  try {
    await navigator.clipboard.writeText(COMMAND);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* the command is selectable */
  }
}
async function checkNow() {
  checking.value = true;
  await loadVersion({ refresh: true });
  checking.value = false;
}

function onDocClick(e) {
  if (open.value && !e.target.closest?.('.version')) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div v-if="label" :class="['version', { alerting }]" @keydown.esc="close">
    <button
      ref="button"
      type="button"
      class="badge"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :title="alerting ? `Update available: v${update.version}` : `Featherkeeper ${label}`"
      @click="toggle"
    >
      <span v-if="alerting" class="dot" aria-hidden="true"></span>
      <span class="current">{{ label }}</span>
      <span v-if="alerting" class="new">Update: v{{ update.version }}</span>
      <span v-if="alerting" class="new-short">Update</span>
    </button>

    <div v-if="open" ref="panel" class="panel" role="dialog" aria-label="Featherkeeper version" tabindex="-1">
      <template v-if="update">
        <p class="title"><strong>Featherkeeper {{ update.version }} is available</strong></p>
        <p class="soft small">
          You’re running {{ versionInfo.current }}.<template v-if="update.publishedAt"> Released {{ when(update.publishedAt) }}.</template>
        </p>
        <div v-if="notes.length" class="notes small">
          <template v-for="(n, i) in notes" :key="i">
            <p v-if="n.kind === 'heading'" class="h">{{ n.text }}</p>
            <p v-else-if="n.kind === 'bullet'" class="li">{{ n.text }}</p>
            <p v-else-if="n.text">{{ n.text }}</p>
          </template>
        </div>
        <p class="small">
          To update, read any “Before you update” notes above, then run this on the server in the Featherkeeper folder
          (<code>/opt/featherkeeper</code> if you used the installer):
        </p>
        <pre class="cmd"><code>{{ COMMAND }}</code></pre>
        <div class="row">
          <button class="btn" type="button" @click="copy">{{ copied ? 'Copied' : 'Copy command' }}</button>
          <a class="btn quiet" :href="update.url" target="_blank" rel="noopener">Release notes</a>
          <button v-if="alerting" class="btn quiet" type="button" @click="notNow">Not now</button>
        </div>
      </template>

      <template v-else>
        <p class="title"><strong>Featherkeeper {{ versionInfo.current }}</strong></p>
        <template v-if="versionInfo.admin">
          <p v-if="versionInfo.enabled === false" class="soft small">Update checks are off (UPDATE_CHECK=false).</p>
          <p v-else-if="versionInfo.error" class="soft small">Couldn’t check for updates: {{ versionInfo.error }}</p>
          <p v-else class="soft small">
            You’re up to date.<template v-if="versionInfo.checkedAt"> Checked {{ when(versionInfo.checkedAt) }}.</template>
          </p>
          <div class="row">
            <button v-if="versionInfo.enabled !== false" class="btn" type="button" :disabled="checking" @click="checkNow">
              {{ checking ? 'Checking...' : 'Check now' }}
            </button>
            <a v-if="versionInfo.releasesUrl" class="btn quiet" :href="versionInfo.releasesUrl" target="_blank" rel="noopener">
              All releases
            </a>
          </div>
        </template>
        <p v-else class="soft small">
          <a href="https://github.com/tposella/featherkeeper/releases" target="_blank" rel="noopener">What’s new in each release</a>
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Sits in the top bar, right of the logo; the panel opens below it. */
.version {
  position: relative;
  font-size: var(--step--1);
  flex: none;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.badge:hover,
.badge:focus-visible {
  color: var(--ink);
  border-color: var(--jay);
}
.alerting .badge {
  color: var(--ink);
  border-color: var(--goldfinch);
  background: var(--goldfinch-wash);
  font-weight: 700;
}
.new {
  border-left: 1px solid var(--goldfinch);
  padding-left: 6px;
}
.new-short {
  display: none;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--goldfinch);
  flex: none;
}
@media (prefers-reduced-motion: no-preference) {
  .alerting .dot {
    animation: pulse 2s ease-in-out infinite;
  }
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.panel {
  position: absolute;
  left: 0;
  top: calc(100% + 10px);
  z-index: 960;
  width: min(420px, calc(100vw - 24px));
  max-height: min(70vh, 560px);
  overflow: auto;
  padding: 14px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--rule);
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.2);
  text-align: left;
  outline: none;
}
/* Phones: a compact badge ("Update" instead of both versions), and the panel spans the screen
   under the top bar (the .version box goes static so the panel positions against the bar). */
@media (max-width: 640px) {
  .version {
    position: static;
  }
  .badge {
    font-size: 0.72rem;
    padding: 2px 8px;
    gap: 5px;
  }
  .alerting .current,
  .new {
    display: none;
  }
  .new-short {
    display: inline;
  }
  .panel {
    left: 12px;
    right: 12px;
    top: calc(100% + 4px);
    width: auto;
  }
}
.panel p {
  margin: 0 0 8px;
}
.title {
  font-size: var(--step-0);
}
.notes {
  border-left: 3px solid var(--rule);
  padding-left: 10px;
  margin: 8px 0 12px;
  max-height: 220px;
  overflow: auto;
}
.notes p {
  margin: 0 0 4px;
}
.notes .h {
  font-weight: 700;
  margin-top: 6px;
}
.notes .li {
  padding-left: 12px;
  text-indent: -10px;
}
.notes .li::before {
  content: '• ';
}
.cmd {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 0.8rem;
  user-select: all;
}
.row {
  gap: 6px 8px;
}
</style>
