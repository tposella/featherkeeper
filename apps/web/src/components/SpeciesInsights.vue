<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { MONTHS, formatDate, timeAgo } from '../format.js';

// "When and where to find it": seasonality, time of day, habitat, recent reports, your own records.
const props = defineProps({
  catalogue: { type: String, required: true },
  speciesId: { type: Number, required: true },
  commonName: { type: String, required: true },
});

const data = ref(null);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    data.value = await api.get(`/catalogues/${props.catalogue}/species/${props.speciesId}/insights`);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});

const SHORT = MONTHS.map((m) => m.slice(0, 3));
const thisMonth = new Date().getMonth();

/** Contiguous runs of indexes (wrapping around the end) where values are at least `share` of the max. */
function peakRuns(values, share) {
  const max = Math.max(...values);
  if (!max) return [];
  const hot = values.map((v) => v >= max * share);
  if (hot.every(Boolean)) return 'all';
  const n = values.length;
  const start = hot.findIndex((h, i) => h && !hot[(i - 1 + n) % n]);
  const runs = [];
  for (let k = 0, i = start; k < n; k += 1, i = (i + 1) % n) {
    if (hot[i] && !hot[(i - 1 + n) % n]) runs.push([i, i]);
    else if (hot[i]) runs.at(-1)[1] = i;
  }
  return runs;
}

const total = (arr) => arr?.reduce((a, b) => a + b, 0) ?? 0;

const monthSummary = computed(() => {
  const m = data.value?.months;
  if (!m || total(m) < 5) return '';
  const minShare = Math.min(...m) / Math.max(...m);
  if (minShare >= 0.25) return 'Photographed here all year round.';
  const runs = peakRuns(m, 0.5);
  if (runs === 'all') return 'Photographed here all year round.';
  const text = runs.map(([a, b]) => (a === b ? MONTHS[a] : `${MONTHS[a]} to ${MONTHS[b]}`)).join(' and ');
  const absent = m.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  return `Most photographed here ${text}.${absent.length >= 3 ? ' Rarely or never seen in the other months.' : ''}`;
});

function hourLabel(h) {
  const suffix = h < 12 ? 'am' : 'pm';
  const v = h % 12 === 0 ? 12 : h % 12;
  return `${v} ${suffix}`;
}
const hourSummary = computed(() => {
  const h = data.value?.hours;
  if (!h) return '';
  const runs = peakRuns(h.hours, 0.6);
  if (runs === 'all' || !runs.length) return '';
  const [a, b] = runs.sort((x, y) => total(h.hours.slice(y[0], y[1] + 1)) - total(h.hours.slice(x[0], x[1] + 1)))[0];
  return `Most photos are taken between ${hourLabel(a)} and ${hourLabel((b + 1) % 24)}.`;
});

// Your own sightings, bucketed in your local time.
const yours = computed(() => {
  const list = data.value?.yours ?? [];
  if (!list.length) return null;
  const months = new Set();
  const hours = new Array(24).fill(0);
  const places = new Map();
  for (const s of list) {
    const d = new Date(s.observedAt);
    months.add(d.getMonth());
    hours[d.getHours()] += 1;
    if (s.where) places.set(s.where, (places.get(s.where) ?? 0) + 1);
  }
  const morning = hours.slice(4, 11).reduce((a, b) => a + b, 0);
  const evening = hours.slice(16, 22).reduce((a, b) => a + b, 0);
  const topPlace = [...places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    count: list.length,
    months: [...months].sort((a, b) => a - b).map((i) => MONTHS[i]),
    timeOfDay: morning > list.length / 2 ? 'mostly in the morning' : evening > list.length / 2 ? 'mostly in the evening' : null,
    topPlace,
    last: list.at(-1).observedAt,
  };
});

const maxMonth = computed(() => Math.max(1, ...(data.value?.months ?? [1])));
const hoursShown = computed(() => {
  // Show 4 am to 11 pm; nights are nearly always empty for photographs.
  const h = data.value?.hours?.hours ?? [];
  return h.slice(4, 24).map((v, i) => ({ hour: i + 4, v }));
});
const maxHour = computed(() => Math.max(1, ...hoursShown.value.map((x) => x.v)));

const nothing = computed(
  () => data.value && !data.value.months && !data.value.hours && !data.value.habitat && !data.value.reports?.length && !yours.value,
);
const where = computed(() => {
  const a = data.value?.area;
  if (!a) return 'in this area';
  if (a.kind === 'region') return `in ${a.regionCode}`;
  if (a.kind === 'sightings') return 'around where you log sightings';
  return `within ${a.radiusKm} km of ${a.label || 'this catalogue’s area'}`;
});
</script>

<template>
  <section class="insights">
    <h3>When and where to find it</h3>
    <p v-if="loading" class="soft">Gathering records...</p>
    <p v-else-if="error" class="soft small">{{ error }}</p>
    <p v-else-if="nothing" class="soft">
      No records yet for {{ commonName }} {{ where }}. Give the catalogue an area (Settings, import “Around a town or
      place”) to see seasons and timing.
    </p>

    <div v-else-if="data" class="grid">
      <div v-if="data.months && total(data.months) >= 5" class="block">
        <h4>Time of year</h4>
        <p class="lead">{{ monthSummary }}</p>
        <div class="bars months" role="img" :aria-label="`Photos per month ${where}: ${data.months.map((v, i) => `${MONTHS[i]} ${v}`).join(', ')}`">
          <div v-for="(v, i) in data.months" :key="i" class="bar" :class="{ now: i === thisMonth }">
            <span class="fill" :style="{ height: Math.max(2, (v / maxMonth) * 100) + '%' }"></span>
            <span class="label">{{ SHORT[i][0] }}</span>
          </div>
        </div>
        <p class="soft small">{{ total(data.months) }} photographed observations {{ where }}, all years (iNaturalist). This month is highlighted.</p>
      </div>

      <div v-if="data.hours" class="block">
        <h4>Time of day</h4>
        <p class="lead">{{ hourSummary || 'No clear time of day.' }}</p>
        <div class="bars hours" role="img" :aria-label="`Photos by hour of day ${where}`">
          <div v-for="x in hoursShown" :key="x.hour" class="bar">
            <span class="fill" :style="{ height: Math.max(2, (x.v / maxHour) * 100) + '%' }"></span>
            <span class="label">{{ x.hour % 3 === 0 ? hourLabel(x.hour).replace(' ', '') : '' }}</span>
          </div>
        </div>
        <p class="soft small">From the {{ data.hours.sample }} most recent observations with a time {{ where }}.</p>
      </div>

      <div v-if="data.habitat" class="block">
        <h4>Habitat</h4>
        <p>{{ data.habitat.text }}</p>
        <p class="soft small">
          From the “{{ data.habitat.section }}” section of
          <a :href="data.habitat.url" target="_blank" rel="noopener">{{ data.habitat.title }}</a> on Wikipedia (CC BY-SA).
        </p>
      </div>

      <div v-if="data.reports?.length" class="block">
        <h4>Reported recently {{ where }}</h4>
        <ul class="reports">
          <li v-for="(r, i) in data.reports" :key="i">
            <strong>{{ r.where || 'A private location' }}</strong>
            <span class="soft small">{{ timeAgo(r.observedAt) }}<template v-if="r.howMany">, {{ r.howMany }} seen</template></span>
          </li>
        </ul>
        <p class="soft small">Last 30 days, from eBird.</p>
      </div>
      <div v-else-if="data.reports" class="block">
        <h4>Reported recently</h4>
        <p class="soft">No eBird reports {{ where }} in the last 30 days.</p>
      </div>

      <div v-if="yours" class="block">
        <h4>Your records</h4>
        <p>
          You’ve logged it {{ yours.count }} time{{ yours.count === 1 ? '' : 's' }}, in {{ yours.months.join(', ') }}<template
            v-if="yours.timeOfDay"
            >, {{ yours.timeOfDay }}</template
          >. Last on {{ formatDate(yours.last) }}<template v-if="yours.topPlace">; most often at {{ yours.topPlace }}</template>.
        </p>
      </div>
    </div>

    <p v-if="data && (data.links.inaturalist || data.links.ebird)" class="links small">
      <a v-if="data.links.ebird" :href="data.links.ebird" target="_blank" rel="noopener">eBird species page</a>
      <a v-if="data.links.inaturalist" :href="data.links.inaturalist" target="_blank" rel="noopener">iNaturalist</a>
    </p>
  </section>
</template>

<style scoped>
.insights {
  margin-bottom: 36px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}
.block {
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 14px 16px;
  background: var(--paper-raised);
}
h4 {
  font-family: var(--font-display);
  font-size: var(--step-0);
  margin: 0 0 6px;
}
.lead {
  font-weight: 700;
  margin-bottom: 10px;
}
.bars {
  display: grid;
  align-items: end;
  gap: 3px;
  height: 96px;
  margin-bottom: 26px;
}
.bars.months {
  grid-template-columns: repeat(12, 1fr);
}
.bars.hours {
  grid-template-columns: repeat(20, 1fr);
  gap: 2px;
}
.bar {
  position: relative;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.fill {
  display: block;
  width: 100%;
  background: var(--jay);
  border-radius: 2px 2px 0 0;
  opacity: 0.75;
}
.bar.now .fill {
  opacity: 1;
  background: var(--goldfinch);
}
.label {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--ink-soft);
  white-space: nowrap;
}
.bar.now .label {
  color: var(--ink);
  font-weight: 700;
}
.reports {
  list-style: none;
  padding: 0;
  margin: 0 0 6px;
  display: grid;
  gap: 4px;
}
.reports li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.links {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}
</style>
