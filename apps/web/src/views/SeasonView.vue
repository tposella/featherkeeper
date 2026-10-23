<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import { MONTHS, timeAgo } from '../format.js';

const { catalogue, reload, reloadDex, dexStyle } = useCatalogue();

const currentMonth = new Date().getMonth() + 1;
const month = ref(currentMonth);
const data = ref(null);
const loading = ref(false);
const error = ref('');
const adding = ref(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.get(`/catalogues/${catalogue.value.slug}/season?month=${month.value}&current=${currentMonth}`);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
watch(month, load, { immediate: true });

const isNow = computed(() => month.value === currentMonth);
const where = computed(() => {
  const a = data.value?.area;
  if (!a) return '';
  if (a.kind === 'region') return `in ${a.regionCode}`;
  if (a.kind === 'sightings') return 'around where you log sightings';
  return `within ${a.radiusKm} km of ${a.label || 'this catalogue’s area'}`;
});

// Ranking: reported recently first (newest first), then by how often it's usually photographed.
function score(s) {
  return (s.now ? 1e9 + Date.parse(String(s.now.observedAt).replace(' ', 'T')) / 1e4 : 0) + (s.usual?.observations ?? 0);
}
const toFind = computed(() =>
  (data.value?.species ?? []).filter((s) => s.status !== 'photographed').sort((a, b) => score(b) - score(a)),
);
const done = computed(() => (data.value?.species ?? []).filter((s) => s.status === 'photographed'));

async function add(s) {
  adding.value = s.ebirdCode;
  try {
    await api.post(`/catalogues/${catalogue.value.slug}/species`, { ebirdCode: s.ebirdCode });
    await Promise.all([reload(), reloadDex(), load()]);
  } catch (err) {
    error.value = err.message;
  } finally {
    adding.value = null;
  }
}
</script>

<template>
  <div class="season">
    <div class="head">
      <h2>
        <label>
          <span class="visually-hidden">Month</span>
          <select v-model.number="month" class="month">
            <option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}{{ i + 1 === currentMonth ? ' (now)' : '' }}</option>
          </select>
        </label>
        <span v-if="where"> {{ where }}</span>
      </h2>
    </div>

    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <p v-if="loading && !data" class="soft">Checking what’s around...</p>

    <template v-if="data">
      <div v-if="!data.area" class="empty">
        <p>This catalogue has no area yet, so there’s nothing to compare against.</p>
        <p class="small">
          Import species “Around a town or place” in
          <RouterLink :to="{ name: 'settings', params: { slug: catalogue.slug }, hash: '#species' }">Settings</RouterLink>,
          or log sightings with a location.
        </p>
      </div>

      <template v-else>
        <p class="soft small sources">
          <template v-if="isNow && data.sources.now">“Reported” means seen in the last 30 days (eBird). </template>
          <template v-if="data.sources.usual">
            “Usually here” counts photographed observations in {{ MONTHS[month - 1] }} over the last five years (iNaturalist).
          </template>
          <template v-if="data.sources.nowError || data.sources.usualError">
            Some data couldn’t be loaded right now: {{ data.sources.nowError || data.sources.usualError }}
          </template>
        </p>

        <section>
          <h3>Still to photograph <span class="n">{{ toFind.length }}</span></h3>
          <p v-if="!toFind.length" class="empty">
            You’ve photographed every species in this catalogue that’s around in {{ MONTHS[month - 1] }}.
          </p>
          <ol class="list">
            <li v-for="s in toFind" :key="s.id">
              <RouterLink :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: s.id } }" class="row-link">
                <span :class="['mini', s.status]"><img v-if="s.coverUrl" :src="s.coverUrl" alt="" /><img v-else-if="dexStyle === 'examples' && s.example" :src="s.example.url" class="example-img" alt="" /></span>
                <span class="names">
                  <strong>{{ s.commonName }}</strong>
                  <span class="sci soft small">{{ s.scientificName }}</span>
                </span>
                <span class="facts small">
                  <span v-if="s.now" class="fact now">
                    Reported {{ timeAgo(s.now.observedAt) }}<template v-if="s.now.where"> at {{ s.now.where }}</template
                    ><template v-if="s.now.howMany">, {{ s.now.howMany }} seen</template>
                  </span>
                  <span v-if="s.usual" class="fact usual">
                    Usually here: {{ s.usual.observations }} photos in recent {{ MONTHS[month - 1] }}s
                  </span>
                  <span v-if="s.status === 'logged'" class="fact seen">You’ve seen it, no photo yet</span>
                </span>
              </RouterLink>
            </li>
          </ol>
        </section>

        <section v-if="done.length">
          <details>
            <summary>
              <h3>Already photographed, also around <span class="n">{{ done.length }}</span></h3>
            </summary>
            <ol class="list">
              <li v-for="s in done" :key="s.id">
                <RouterLink :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: s.id } }" class="row-link">
                  <span :class="['mini', s.status]"><img v-if="s.coverUrl" :src="s.coverUrl" alt="" /><img v-else-if="dexStyle === 'examples' && s.example" :src="s.example.url" class="example-img" alt="" /></span>
                  <span class="names"><strong>{{ s.commonName }}</strong></span>
                  <span class="facts small">
                    <span v-if="s.now" class="fact now">Reported {{ timeAgo(s.now.observedAt) }}</span>
                    <span v-if="s.usual" class="fact usual">Usually here: {{ s.usual.observations }} photos</span>
                  </span>
                </RouterLink>
              </li>
            </ol>
          </details>
        </section>

        <section v-if="isNow && data.notInCatalogue.length">
          <h3>Reported nearby, not in this catalogue <span class="n">{{ data.notInCatalogue.length }}</span></h3>
          <p class="soft small">Often rarities or birds passing through. Add them if you want to chase them.</p>
          <ol class="list">
            <li v-for="s in data.notInCatalogue" :key="s.ebirdCode" class="plain">
              <span class="names">
                <strong>{{ s.commonName }}</strong>
                <span class="sci soft small">{{ s.scientificName }}</span>
              </span>
              <span class="facts small">
                <span class="fact now">Reported {{ timeAgo(s.observedAt) }}<template v-if="s.where"> at {{ s.where }}</template></span>
              </span>
              <button
                v-if="catalogue.access.canEdit"
                class="btn quiet small"
                type="button"
                :disabled="adding === s.ebirdCode"
                @click="add(s)"
              >
                {{ adding === s.ebirdCode ? 'Adding...' : 'Add to catalogue' }}
              </button>
            </li>
          </ol>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.head h2 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  font-size: var(--step-2);
}
.month {
  font: inherit;
  font-family: var(--font-display);
  font-weight: 650;
  width: auto;
  padding: 2px 8px;
}
.sources {
  max-width: 80ch;
}
section {
  margin-top: 28px;
}
h3 .n,
summary .n {
  font-weight: 400;
  color: var(--ink-soft);
  margin-left: 6px;
}
details summary {
  cursor: pointer;
  list-style: revert;
}
details summary h3 {
  display: inline;
}
.list {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}
.list li {
  border-bottom: 1px solid var(--rule);
}
.row-link,
.list li.plain {
  display: grid;
  grid-template-columns: 48px minmax(160px, 1fr) 2fr;
  gap: 14px;
  align-items: center;
  padding: 8px 0;
  color: inherit;
  text-decoration: none;
}
.list li.plain {
  grid-template-columns: minmax(160px, 1fr) 2fr auto;
}
.row-link:hover strong {
  color: var(--jay);
}
.mini {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  overflow: hidden;
  display: block;
}
.mini img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mini.missing {
  border: 1.5px dashed var(--rule);
}
.mini.logged {
  border: 1.5px dashed var(--goldfinch);
  background: var(--goldfinch-wash);
}
.names {
  display: grid;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.fact {
  border-radius: 999px;
  padding: 1px 10px;
  border: 1px solid var(--rule);
}
.fact.now {
  border-color: var(--jay);
  color: var(--jay);
}
.fact.seen {
  border-color: var(--goldfinch);
}
@media (max-width: 640px) {
  .row-link {
    grid-template-columns: 48px 1fr;
  }
  .row-link .facts {
    grid-column: 2;
  }
  .list li.plain {
    grid-template-columns: 1fr;
  }
}
</style>
