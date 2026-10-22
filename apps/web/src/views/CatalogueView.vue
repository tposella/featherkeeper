<script setup>
import { provide, ref, watch } from 'vue';
import { api } from '../api.js';
import { CATALOGUE_KEY } from '../catalogue-context.js';
import ProgressBar from '../components/ProgressBar.vue';
import { visibilityLabels } from '../format.js';

const props = defineProps({ slug: { type: String, required: true } });

const catalogue = ref(null);
const species = ref([]);
const error = ref('');
const notFound = ref(false);

async function reload() {
  catalogue.value = (await api.get(`/catalogues/${props.slug}`)).catalogue;
}
async function reloadDex() {
  species.value = (await api.get(`/catalogues/${props.slug}/species`)).species;
}

async function loadAll() {
  error.value = '';
  notFound.value = false;
  catalogue.value = null;
  try {
    await Promise.all([reload(), reloadDex()]);
  } catch (err) {
    if (err.status === 404) notFound.value = true;
    else error.value = err.message;
  }
}

watch(() => props.slug, loadAll, { immediate: true });

provide(CATALOGUE_KEY, { catalogue, species, reload, reloadDex });
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
            :logged="catalogue.stats.logged"
            :total="catalogue.stats.species"
          />
          <RouterLink
            v-if="catalogue.access.canEdit"
            :to="{ name: 'log', params: { slug } }"
            class="btn primary log"
          >
            Log a sighting
          </RouterLink>
        </div>
      </header>

      <nav class="tabs" aria-label="Catalogue sections">
        <RouterLink :to="{ name: 'dex', params: { slug } }" exact-active-class="on">Dex</RouterLink>
        <RouterLink :to="{ name: 'map', params: { slug } }" active-class="on">Map</RouterLink>
        <RouterLink :to="{ name: 'recent', params: { slug } }" active-class="on">Recent sightings</RouterLink>
        <RouterLink
          v-if="catalogue.access.canEdit"
          :to="{ name: 'settings', params: { slug } }"
          active-class="on"
        >
          Settings
        </RouterLink>
      </nav>

      <RouterView :key="$route.fullPath" />
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
</style>
