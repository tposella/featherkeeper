<script setup>
import { computed, nextTick, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { CATALOGUE_KEY } from '../catalogue-context.js';
import ProgressBar from '../components/ProgressBar.vue';
import { visibilityLabels } from '../format.js';

const props = defineProps({ slug: { type: String, required: true } });

const catalogue = ref(null);
const species = ref([]);
const error = ref('');
const notFound = ref(false);

// How the dex shows species you haven't photographed: 'slots' (empty frames) or 'examples'
// (a greyed-out example photo). The catalogue sets the default; each viewer can switch, and
// their choice is remembered in this browser.
const dexStyle = ref('examples');
const examplesPending = ref(0);
const styleKey = () => `featherkeeper:dex-style:${props.slug}`;
function loadDexStyle() {
  let saved = null;
  try {
    saved = localStorage.getItem(styleKey());
  } catch {
    /* storage unavailable */
  }
  dexStyle.value = saved === 'slots' || saved === 'examples' ? saved : catalogue.value?.dexStyle ?? 'examples';
}
function setDexStyle(style) {
  dexStyle.value = style;
  try {
    localStorage.setItem(styleKey(), style);
  } catch {
    /* storage unavailable */
  }
  if (style === 'examples') reloadDex();
}

async function reload() {
  catalogue.value = (await api.get(`/catalogues/${props.slug}`)).catalogue;
}
// Example photos are fetched on the server a few per second, so while some are still coming,
// check back now and then until they've all arrived.
let pollTimer = null;
let polls = 0;
async function reloadDex() {
  const examples = dexStyle.value === 'examples';
  const res = await api.get(`/catalogues/${props.slug}/species${examples ? '?examples=1' : ''}`);
  species.value = res.species;
  examplesPending.value = examples ? res.examplesPending ?? 0 : 0;
  clearTimeout(pollTimer);
  if (examples && res.examplesPending > 0 && polls < 120) {
    polls += 1;
    pollTimer = setTimeout(() => reloadDex().catch(() => {}), 5000);
  } else {
    polls = 0;
  }
}
onUnmounted(() => clearTimeout(pollTimer));

async function loadAll() {
  error.value = '';
  notFound.value = false;
  catalogue.value = null;
  try {
    loadDexStyle(); // a saved choice is known before the catalogue loads, so fetch both at once
    await Promise.all([reload(), reloadDex()]);
  } catch (err) {
    if (err.status === 404) notFound.value = true;
    else error.value = err.message;
  }
}

watch(() => props.slug, loadAll, { immediate: true });
// Follow the catalogue's default (it loads after the first fetch, and the owner can change it),
// unless this viewer has picked a view themselves.
watch(
  () => catalogue.value?.dexStyle,
  () => {
    const was = dexStyle.value;
    loadDexStyle();
    if (dexStyle.value !== was) reloadDex().catch(() => {});
  },
);

// ---- Phone navigation ---------------------------------------------------------
// On small screens the section tabs become a bottom bar (within thumb reach) with "Log" in the
// middle; less-used sections sit in a "More" sheet. Desktop keeps the tabs.
const route = useRoute();
const moreOpen = ref(false);
const moreBtn = ref(null);
const sheet = ref(null);
const canEdit = computed(() => Boolean(catalogue.value?.access.canEdit));
const inDex = computed(() => ['dex', 'species'].includes(route.name));
// Sections in the More sheet: editors have Log in the bar, so Map moves in here.
const moreItems = computed(() =>
  canEdit.value
    ? [
        { name: 'map', label: 'Map' },
        { name: 'recent', label: 'Recent sightings' },
        { name: 'to-replace', label: 'To replace', count: catalogue.value?.stats.toReplace || 0 },
        { name: 'settings', label: 'Settings' },
      ]
    : [],
);
const moreActive = computed(() => moreItems.value.some((i) => i.name === route.name));
async function openMore() {
  moreOpen.value = true;
  await nextTick();
  sheet.value?.querySelector('a')?.focus();
}
function closeMore() {
  moreOpen.value = false;
  moreBtn.value?.focus();
}
watch(() => route.fullPath, () => (moreOpen.value = false));

provide(CATALOGUE_KEY, { catalogue, species, reload, reloadDex, dexStyle, setDexStyle, examplesPending });
</script>

<template>
  <div class="page">
    <div v-if="notFound">
      <h1>Catalogue not found</h1>
      <p>It doesn't exist, or it's private. Signing in may help.</p>
      <RouterLink to="/" class="btn">Go to catalogues</RouterLink>
    </div>
    <div v-else-if="error" class="notice error" role="alert">{{ error }}</div>

    <template v-else-if="catalogue">
      <header class="cat-head">
        <div class="title">
          <h1>{{ catalogue.name }}</h1>
          <p class="soft">
            Kept by {{ catalogue.ownerName }}<template v-if="catalogue.regionCode"> in {{ catalogue.regionCode }}</template>.
            {{ visibilityLabels[catalogue.visibility] }} catalogue.
          </p>
          <p v-if="catalogue.description" class="desc">{{ catalogue.description }}</p>
        </div>
        <div class="tally">
          <p class="big">
            <span class="num">{{ catalogue.stats.photographed }}</span>
            <span class="of">of {{ catalogue.stats.species }}</span>
          </p>
          <p class="soft small">species photographed</p>
          <ProgressBar
            :photographed="catalogue.stats.photographed"
            :total="catalogue.stats.species"
          />
          <RouterLink
            v-if="catalogue.access.canEdit && !['log', 'log-bulk'].includes($route.name)"
            :to="{ name: 'log', params: { slug } }"
            class="btn primary log"
          >
            Log a sighting
          </RouterLink>
        </div>
      </header>

      <nav class="tabs" aria-label="Catalogue sections">
        <RouterLink
          :to="{ name: 'dex', params: { slug } }"
          :class="{ on: ['dex', 'species'].includes($route.name) }"
          :aria-current="['dex', 'species'].includes($route.name) ? 'page' : undefined"
        >
          Dex
        </RouterLink>
        <RouterLink :to="{ name: 'families', params: { slug } }" active-class="on">Families</RouterLink>
        <RouterLink :to="{ name: 'season', params: { slug } }" active-class="on">In season</RouterLink>
        <RouterLink :to="{ name: 'map', params: { slug } }" active-class="on">Map</RouterLink>
        <RouterLink :to="{ name: 'recent', params: { slug } }" active-class="on">Recent sightings</RouterLink>
        <RouterLink v-if="catalogue.access.canEdit" :to="{ name: 'to-replace', params: { slug } }" active-class="on">
          To replace<span v-if="catalogue.stats.toReplace" class="tab-count"
            >{{ catalogue.stats.toReplace }}<span class="visually-hidden"> photos</span></span
          >
        </RouterLink>
        <RouterLink
          v-if="catalogue.access.canEdit"
          :to="{ name: 'settings', params: { slug } }"
          active-class="on"
        >
          Settings
        </RouterLink>
      </nav>

      <RouterView :key="$route.fullPath" />

      <nav class="bottom-nav" aria-label="Catalogue sections">
        <RouterLink :to="{ name: 'dex', params: { slug } }" :class="{ on: inDex }" :aria-current="inDex ? 'page' : undefined">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
          <span>Dex</span>
        </RouterLink>
        <RouterLink :to="{ name: 'families', params: { slug } }" active-class="on">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v6M12 9H6v5M12 9h6v5M6 14v3M18 14v3M12 9v8" /><circle cx="6" cy="19" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></svg>
          <span>Families</span>
        </RouterLink>
        <RouterLink
          v-if="canEdit"
          :to="{ name: 'log', params: { slug } }"
          class="log-tab"
          active-class="on"
        >
          <span class="plus" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span>Log</span>
        </RouterLink>
        <RouterLink :to="{ name: 'season', params: { slug } }" active-class="on">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
          <span>In season</span>
        </RouterLink>
        <RouterLink v-if="!canEdit" :to="{ name: 'map', params: { slug } }" active-class="on">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>
          <span>Map</span>
        </RouterLink>
        <RouterLink v-if="!canEdit" :to="{ name: 'recent', params: { slug } }" active-class="on">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
          <span>Recent</span>
        </RouterLink>
        <button
          v-else
          ref="moreBtn"
          type="button"
          :class="{ on: moreActive }"
          aria-haspopup="dialog"
          :aria-expanded="moreOpen"
          @click="openMore"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          <span>More</span>
          <span v-if="catalogue.stats.toReplace" class="dot" aria-hidden="true"></span>
        </button>
      </nav>

      <div v-if="moreOpen" class="sheet-backdrop" @click.self="closeMore" @keydown.esc="closeMore">
        <div ref="sheet" class="sheet" role="dialog" aria-modal="true" aria-label="More sections">
          <span class="grabber" aria-hidden="true"></span>
          <RouterLink
            v-for="item in moreItems"
            :key="item.name"
            :to="{ name: item.name, params: { slug } }"
            :class="{ on: $route.name === item.name }"
          >
            {{ item.label }}
            <span v-if="item.count" class="tab-count">{{ item.count }}<span class="visually-hidden"> photos</span></span>
          </RouterLink>
          <button type="button" class="btn quiet close" @click="closeMore">Close</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cat-head {
  display: grid;
  grid-template-columns: 1fr minmax(220px, 280px);
  gap: 24px 40px;
  align-items: end;
  padding-bottom: 20px;
}
.title p {
  margin-bottom: 4px;
}
.desc {
  margin-top: 10px;
}
.big {
  margin: 0;
  font-family: var(--font-display);
  line-height: 1;
}
.num {
  font-size: var(--step-4);
  font-weight: 700;
  color: var(--jay);
}
.of {
  font-size: var(--step-1);
  margin-left: 6px;
}
.tally .small {
  margin: 4px 0 10px;
}
.log {
  margin-top: 16px;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 24px;
  overflow-x: auto;
}
.tabs a {
  padding: 10px 14px;
  color: var(--ink-soft);
  text-decoration: none;
  font-weight: 700;
  border-bottom: 3px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
}
.tabs a:hover {
  color: var(--ink);
}
.tabs a.on {
  color: var(--ink);
  border-bottom-color: var(--jay);
}
@media (max-width: 700px) {
  .cat-head {
    grid-template-columns: 1fr;
  }
}
/* ---- Phones: compact header, bottom navigation bar ---------------------- */
.bottom-nav,
.sheet-backdrop {
  display: none;
}
@media (max-width: 640px) {
  .cat-head {
    gap: 10px;
    padding-bottom: 14px;
  }
  .cat-head h1 {
    font-size: var(--step-3);
    margin-bottom: 4px;
  }
  .title p {
    margin: 0 0 2px;
    font-size: var(--step--1);
  }
  /* Long descriptions take two lines at most, so the dex starts near the top of the screen. */
  .desc {
    margin-top: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tally {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 2px 12px;
  }
  .tally .big {
    grid-row: span 2;
  }
  .num {
    font-size: var(--step-3);
  }
  .of {
    font-size: var(--step-0);
  }
  .tally .small {
    margin: 0;
  }
  /* The bottom bar has Log and the sections. */
  .tally .log,
  .tabs {
    display: none;
  }

  .bottom-nav {
    display: flex;
    position: fixed;
    z-index: 900;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
    background: var(--paper-raised);
    border-top: 1px solid var(--rule);
    box-shadow: 0 -2px 12px rgb(0 0 0 / 0.06);
  }
  .bottom-nav > a,
  .bottom-nav > button {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    min-height: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ink-soft);
    text-decoration: none;
    background: none;
    border: 0;
    border-radius: var(--radius);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .bottom-nav span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .bottom-nav svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .bottom-nav .on {
    color: var(--jay);
  }
  .bottom-nav .on svg {
    stroke-width: 2.3;
  }
  .bottom-nav a:focus-visible,
  .bottom-nav button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  /* "Log" is the main action: a raised round button in the middle of the bar. */
  .log-tab .plus {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-top: -18px;
    border-radius: 50%;
    background: var(--jay);
    box-shadow: 0 3px 10px rgb(0 0 0 / 0.2);
    border: 3px solid var(--paper-raised);
  }
  .log-tab .plus svg {
    stroke: var(--paper-raised);
    stroke-width: 2.6;
  }
  .bottom-nav .dot {
    position: absolute;
    top: 8px;
    right: calc(50% - 16px);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--goldfinch);
  }

  .sheet-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 950;
    background: rgb(10 14 12 / 0.45);
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    padding: 8px 12px calc(12px + env(safe-area-inset-bottom));
    background: var(--paper-raised);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -4px 20px rgb(0 0 0 / 0.2);
  }
  .grabber {
    justify-self: center;
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--rule);
    margin: 2px 0 8px;
  }
  .sheet a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 0 12px;
    border-radius: var(--radius);
    color: var(--ink);
    font-weight: 700;
    text-decoration: none;
  }
  .sheet a.on {
    color: var(--jay);
    background: var(--jay-wash);
  }
  .sheet .close {
    margin-top: 6px;
    justify-content: center;
    min-height: 48px;
  }
}
@media (max-width: 640px) and (prefers-reduced-motion: no-preference) {
  .sheet {
    animation: sheet-up 0.18s ease-out;
  }
}
@keyframes sheet-up {
  from {
    transform: translateY(30px);
    opacity: 0;
  }
}
.tab-count {
  display: inline-block;
  margin-left: 6px;
  min-width: 1.5em;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--goldfinch-wash);
  color: var(--ink);
  font-size: var(--step--1);
  text-align: center;
}
</style>
