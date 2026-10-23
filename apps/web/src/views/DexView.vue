<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCatalogue } from '../catalogue-context.js';
import { plateNumber } from '../format.js';

const { catalogue, species, dexStyle, setDexStyle, examplesPending } = useCatalogue();
const examples = computed(() => dexStyle.value === 'examples');

const query = ref('');
const status = ref('all');
const route = useRoute();
const router = useRouter();
// The family filter lives in the URL (?family=...), so the Families view can link straight to it.
const family = ref(typeof route.query.family === 'string' ? route.query.family : '');
watch(family, (value) => {
  router.replace({ query: { ...route.query, family: value || undefined } });
});

// Plate numbers follow taxonomic order across the whole dex, so they stay put while filtering.
const numbered = computed(() => species.value.map((s, i) => ({ ...s, plate: i + 1 })));

const families = computed(() => {
  const seen = new Map();
  for (const s of species.value) {
    const key = s.familyCommon || s.familyScientific;
    if (key && !seen.has(key)) seen.set(key, s.familyScientific);
  }
  return [...seen.entries()].map(([name, sci]) => ({ name, sci }));
});

// Counts follow the family filter, so "Not yet" means not yet within that family.
const counts = computed(() => {
  const pool = family.value
    ? species.value.filter((s) => (s.familyCommon || s.familyScientific) === family.value)
    : species.value;
  const c = { all: pool.length, photographed: 0, logged: 0, missing: 0 };
  for (const s of pool) c[s.status] += 1;
  return c;
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return numbered.value.filter((s) => {
    if (status.value !== 'all' && s.status !== status.value) return false;
    if (family.value && (s.familyCommon || s.familyScientific) !== family.value) return false;
    if (!q) return true;
    return (
      s.commonName.toLowerCase().includes(q) ||
      s.scientificName.toLowerCase().includes(q) ||
      String(s.plate) === q.replace(/^#?0*/, '')
    );
  });
});

const filters = [
  { value: 'all', label: 'All' },
  { value: 'photographed', label: 'Photographed' },
  { value: 'logged', label: 'Seen, no photo' },
  { value: 'missing', label: 'Not yet' },
];
</script>

<template>
  <div>
    <div v-if="!species.length" class="empty">
      <p>This dex has no species yet.</p>
      <RouterLink
        v-if="catalogue.access.canEdit"
        :to="{ name: 'settings', params: { slug: catalogue.slug }, hash: '#species' }"
        class="btn primary"
      >
        Add species
      </RouterLink>
    </div>

    <template v-else>
      <div class="controls">
        <div class="seg" role="radiogroup" aria-label="Show">
          <button
            v-for="f in filters"
            :key="f.value"
            type="button"
            role="radio"
            :aria-checked="status === f.value"
            :class="['seg-btn', f.value, { on: status === f.value }]"
            @click="status = f.value"
          >
            {{ f.label }} <span class="n">{{ counts[f.value] }}</span>
          </button>
        </div>
        <label class="search">
          <span class="visually-hidden">Search species</span>
          <input v-model="query" type="search" placeholder="Search by name or number" />
        </label>
        <label class="fam">
          <span class="visually-hidden">Family</span>
          <select v-model="family">
            <option value="">All families</option>
            <option v-for="f in families" :key="f.name" :value="f.name">{{ f.name }}</option>
          </select>
        </label>
        <div class="seg view" role="radiogroup" aria-label="Species not yet photographed show as">
          <button
            type="button"
            role="radio"
            :aria-checked="!examples"
            :class="['seg-btn', { on: !examples }]"
            title="Species you haven't photographed show as an empty slot"
            @click="setDexStyle('slots')"
          >
            Empty slots
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="examples"
            :class="['seg-btn', { on: examples }]"
            title="Species you haven't photographed show a greyed-out example photo"
            @click="setDexStyle('examples')"
          >
            Greyed examples
          </button>
        </div>
      </div>

      <p v-if="examples && examplesPending" class="soft small fetching" role="status">
        Fetching example photos: {{ examplesPending }} to go. They’ll appear as they arrive.
      </p>

      <p v-if="!filtered.length" class="empty">No species match these filters.</p>

      <ol class="plates">
        <li v-for="s in filtered" :key="s.id">
          <RouterLink
            :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: s.id } }"
            :class="['plate', s.status, { 'has-example': examples && !s.coverUrl && s.example }]"
          >
            <div class="frame">
              <img v-if="s.coverUrl" :src="s.coverUrl" alt="" loading="lazy" />
              <img
                v-else-if="examples && s.example"
                :src="s.example.url"
                class="example-img"
                alt=""
                :title="`Example photo: ${s.example.credit}`"
                loading="lazy"
              />
              <span v-else class="placeholder">{{ s.status === 'logged' ? 'Seen, not yet photographed' : 'Not yet photographed' }}</span>
            </div>
            <div class="label">
              <span class="no">{{ plateNumber(s.plate) }}</span>
              <span class="name">{{ s.commonName }}</span>
              <span class="sci small">{{ s.scientificName }}</span>
              <span v-if="s.familyCommon || s.familyScientific" class="family small">
                {{ s.familyCommon || s.familyScientific }}
              </span>
            </div>
            <span v-if="s.status === 'logged'" class="flag small">Seen</span>
          </RouterLink>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
}
.seg {
  display: flex;
  flex-wrap: wrap;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  overflow: hidden;
}
.seg-btn {
  font: inherit;
  font-size: var(--step--1);
  font-weight: 700;
  border: 0;
  border-right: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-soft);
  padding: 7px 12px;
  cursor: pointer;
}
.seg-btn:last-child {
  border-right: 0;
}
.seg-btn.on {
  background: var(--ink);
  color: var(--paper);
}
.seg-btn .n {
  font-weight: 400;
  margin-left: 4px;
}
.search {
  flex: 1 1 200px;
}
.view {
  margin-left: auto;
}
.fetching {
  margin: -8px 0 14px;
}
.fam {
  flex: 0 1 240px;
}

.plates {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 18px 16px;
}
.plate {
  position: relative;
  display: block;
  color: inherit;
  text-decoration: none;
}
.frame {
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--paper-raised);
  display: grid;
  place-items: center;
}
.frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* Gaps in the dex read at a glance: an empty dashed frame, gold when seen but not yet photographed. */
.plate.missing .frame {
  border: 1.5px dashed var(--rule);
  background: transparent;
}
.plate.logged .frame {
  border: 1.5px dashed var(--goldfinch);
  background: var(--goldfinch-wash);
}
/* With an example photo, the frame is solid so the picture reads as a dex entry still to fill. */
.plate.has-example .frame {
  border-style: solid;
  border-width: 1px;
}
.placeholder {
  padding: 12px;
  text-align: center;
  color: var(--ink-soft);
  font-size: var(--step--1);
  font-style: italic;
}
.plate:hover .frame {
  outline: 2px solid var(--jay);
  outline-offset: 2px;
}
.label {
  display: grid;
  padding-top: 8px;
}
.no {
  font-family: var(--font-display);
  font-size: var(--step--1);
  font-weight: 600;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}
.plate.photographed .no {
  color: var(--jay);
}
.name {
  font-family: var(--font-display);
  font-weight: 650;
  line-height: 1.2;
}
.sci {
  font-style: italic;
  color: var(--ink-soft);
}
.family {
  color: var(--ink-soft);
  margin-top: 2px;
  line-height: 1.3;
}
.plate.missing .name {
  color: var(--ink-soft);
}
.flag {
  position: absolute;
  top: 8px;
  left: 8px;
  background: var(--goldfinch);
  color: #1e2a23;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 999px;
}
@media (max-width: 480px) {
  .plates {
    grid-template-columns: repeat(2, 1fr);
    gap: 14px 10px;
  }
}
</style>
