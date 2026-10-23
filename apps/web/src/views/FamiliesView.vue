<script setup>
import { computed, ref } from 'vue';
import { useCatalogue } from '../catalogue-context.js';
import ProgressBar from '../components/ProgressBar.vue';

const { catalogue, species, dexStyle } = useCatalogue();

const sort = ref('taxonomic');
const hideComplete = ref(false);

// Group the dex by family, keeping taxonomic order within and between families.
const families = computed(() => {
  const groups = new Map();
  species.value.forEach((s, i) => {
    const key = s.familyScientific || s.familyCommon || 'Other';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: s.familyCommon || s.familyScientific || 'Other species',
        scientific: s.familyCommon && s.familyScientific ? s.familyScientific : null,
        order: s.taxonOrder,
        firstPlate: i + 1,
        species: [],
      });
    }
    groups.get(key).species.push({ ...s, plate: i + 1 });
  });
  return [...groups.values()].map((f) => {
    const photographed = f.species.filter((s) => s.status === 'photographed').length;
    const logged = f.species.filter((s) => s.status !== 'missing').length;
    return { ...f, total: f.species.length, photographed, logged, missing: f.species.length - logged };
  });
});

const sorters = {
  taxonomic: (a, b) => a.firstPlate - b.firstPlate,
  missing: (a, b) => b.total - b.photographed - (a.total - a.photographed) || a.firstPlate - b.firstPlate,
  complete: (a, b) => b.photographed / b.total - a.photographed / a.total || b.total - a.total,
  name: (a, b) => a.name.localeCompare(b.name),
};

const shown = computed(() =>
  families.value.filter((f) => !hideComplete.value || f.photographed < f.total).sort(sorters[sort.value]),
);

const totals = computed(() => ({
  families: families.value.length,
  complete: families.value.filter((f) => f.photographed === f.total).length,
  started: families.value.filter((f) => f.photographed > 0).length,
}));

const sortOptions = [
  { value: 'taxonomic', label: 'Field guide order' },
  { value: 'missing', label: 'Most left to photograph' },
  { value: 'complete', label: 'Closest to complete' },
  { value: 'name', label: 'A to Z' },
];

function summary(f) {
  const seenOnly = f.logged - f.photographed;
  let text = `${f.photographed} of ${f.total} photographed`;
  if (seenOnly) text += `, ${seenOnly} more seen`;
  return text;
}
</script>

<template>
  <div>
    <p v-if="!species.length" class="empty">This dex has no species yet.</p>

    <template v-else>
      <div class="controls">
        <p class="overview">
          <strong>{{ totals.started }}</strong> of {{ totals.families }} families started,
          <strong>{{ totals.complete }}</strong> complete.
        </p>
        <label class="sort">
          <span class="visually-hidden">Sort families</span>
          <select v-model="sort">
            <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="check">
          <input v-model="hideComplete" type="checkbox" />
          Hide complete families
        </label>
      </div>

      <p v-if="!shown.length" class="empty">Every family is complete. Impressive.</p>

      <ul class="families">
        <li v-for="f in shown" :key="f.key" class="family" :class="{ done: f.photographed === f.total }">
          <header>
            <div>
              <h2>{{ f.name }}</h2>
              <p class="soft small">
                <span v-if="f.scientific" class="sci">{{ f.scientific }}</span>
                <span v-if="f.scientific && f.order">, </span>
                <span v-if="f.order">{{ f.order }}</span>
              </p>
            </div>
            <span v-if="f.photographed === f.total" class="complete">Complete</span>
          </header>

          <ProgressBar :photographed="f.photographed" :logged="f.logged" :total="f.total" />
          <p class="count small">
            {{ summary(f) }}<template v-if="f.missing">, {{ f.missing }} still to find</template>.
          </p>

          <ol class="mini">
            <li v-for="s in f.species" :key="s.id">
              <RouterLink
                :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: s.id } }"
                :class="['mini-plate', s.status]"
                :title="`${s.commonName}: ${s.status === 'photographed' ? 'photographed' : s.status === 'logged' ? 'seen, no photo yet' : 'not yet seen'}`"
              >
                <img v-if="s.coverUrl" :src="s.coverUrl" alt="" loading="lazy" />
                <img v-else-if="dexStyle === 'examples' && s.example" :src="s.example.url" class="example-img" alt="" loading="lazy" />
                <span class="visually-hidden">{{ s.commonName }}</span>
              </RouterLink>
            </li>
          </ol>

          <details class="list">
            <summary>List {{ f.total }} species</summary>
            <ul>
              <li v-for="s in f.species" :key="s.id">
                <span :class="['dot', s.status]" aria-hidden="true"></span>
                <RouterLink :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: s.id } }">
                  {{ s.commonName }}
                </RouterLink>
                <span class="soft small">
                  {{ s.status === 'photographed' ? 'Photographed' : s.status === 'logged' ? 'Seen, no photo' : 'Not yet' }}
                </span>
              </li>
            </ul>
          </details>

          <RouterLink :to="{ name: 'dex', params: { slug: catalogue.slug }, query: { family: f.name } }" class="small open">
            Open in the dex
          </RouterLink>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
  margin-bottom: 20px;
}
.overview {
  margin: 0 auto 0 0;
}
.sort select {
  width: auto;
}
.check {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.families {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
}
.family {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 16px 18px 14px;
  display: grid;
  align-content: start;
  gap: 8px;
}
.family.done {
  border-color: var(--jay);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
h2 {
  font-size: var(--step-1);
  margin: 0;
}
header p {
  margin: 2px 0 0;
}
.complete {
  font-size: var(--step--1);
  font-weight: 700;
  color: var(--jay);
  border: 1px solid var(--jay);
  border-radius: 999px;
  padding: 1px 10px;
  white-space: nowrap;
}
.count {
  margin: 0;
}
.mini {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mini-plate {
  display: block;
  width: 40px;
  height: 40px;
  border-radius: 4px;
  overflow: hidden;
}
.mini-plate img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* Same language as the dex: dashed empty frame, gold when seen but not photographed. */
.mini-plate.missing {
  border: 1.5px dashed var(--rule);
}
.mini-plate.logged {
  border: 1.5px dashed var(--goldfinch);
  background: var(--goldfinch-wash);
}
.mini-plate:hover,
.mini-plate:focus-visible {
  outline: 2px solid var(--jay);
  outline-offset: 1px;
}
.list summary {
  cursor: pointer;
  color: var(--jay);
  font-weight: 700;
  font-size: var(--step--1);
}
.list ul {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  gap: 4px;
}
.list li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.list li .soft {
  margin-left: auto;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px dashed var(--rule);
  flex: none;
}
.dot.photographed {
  background: var(--jay);
  border: 0;
}
.dot.logged {
  background: var(--goldfinch);
  border: 0;
}
.open {
  justify-self: start;
}
@media (max-width: 420px) {
  .families {
    grid-template-columns: 1fr;
  }
}
</style>
