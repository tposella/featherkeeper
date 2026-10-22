<script setup>
import L from 'leaflet';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { TILE_ATTRIBUTION, TILE_URL } from '../map-tiles.js';
import { session } from '../session.js';

// v-model: { latitude, longitude, radiusKm, label } or latitude null when nothing is chosen yet.
const model = defineModel({ type: Object, required: true });

const el = ref(null);
const query = ref('');
const places = ref([]);
const searching = ref(false);
const searchError = ref('');
let map;
let circle;
let pin;

const RADII = [5, 10, 15, 25, 35, 50];

function draw(fit) {
  if (!map) return;
  const { latitude, longitude, radiusKm } = model.value;
  if (latitude === null || latitude === undefined) return;
  const at = [latitude, longitude];
  const style = { color: '#2c6a8a', weight: 2, fillColor: '#2c6a8a', fillOpacity: 0.1 };
  if (!circle) circle = L.circle(at, { ...style, radius: radiusKm * 1000 }).addTo(map);
  else circle.setLatLng(at).setRadius(radiusKm * 1000);
  if (!pin) pin = L.circleMarker(at, { radius: 6, color: '#1e2a23', weight: 2, fillColor: '#2c6a8a', fillOpacity: 1 }).addTo(map);
  else pin.setLatLng(at);
  if (fit) map.fitBounds(circle.getBounds(), { padding: [16, 16] });
}

onMounted(() => {
  map = L.map(el.value, { scrollWheelZoom: false }).setView([54, -100], 3);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(map);
  map.on('click', (e) => {
    model.value = {
      ...model.value,
      latitude: Math.round(e.latlng.lat * 1e4) / 1e4,
      longitude: Math.round(e.latlng.lng * 1e4) / 1e4,
      label: '', // a clicked point is no longer the searched town
    };
  });
  draw(true);
});
onUnmounted(() => map?.remove());

watch(
  () => [model.value.latitude, model.value.longitude, model.value.radiusKm],
  // Re-fit the view when the centre moves to a new place; a radius change refits in setRadius.
  ([lat, lng], [oldLat, oldLng]) => draw(lat !== oldLat || lng !== oldLng),
);

async function search() {
  searchError.value = '';
  places.value = [];
  if (query.value.trim().length < 2) return;
  searching.value = true;
  try {
    places.value = (await api.get(`/places?q=${encodeURIComponent(query.value.trim())}`)).places;
    if (!places.value.length) searchError.value = 'No places found. Try adding the province or country.';
  } catch (err) {
    searchError.value = err.message;
  } finally {
    searching.value = false;
  }
}

function choose(p) {
  model.value = { ...model.value, latitude: p.latitude, longitude: p.longitude, label: p.name };
  query.value = p.name;
  places.value = [];
}

function setRadius(r) {
  model.value = { ...model.value, radiusKm: r };
  draw(true);
}
</script>

<template>
  <div class="area">
    <form v-if="session.config.placeSearchEnabled !== false" class="search" role="search" @submit.prevent="search">
      <label class="field">
        <span>Town or city</span>
        <input v-model="query" type="search" placeholder="Cochrane, Alberta" autocomplete="off" />
      </label>
      <button class="btn" type="submit" :disabled="searching">{{ searching ? 'Searching...' : 'Find' }}</button>
    </form>
    <p v-if="searchError" class="soft small" role="status">{{ searchError }}</p>
    <ul v-if="places.length" class="places">
      <li v-for="p in places" :key="`${p.latitude},${p.longitude}`">
        <button type="button" @click="choose(p)">
          <strong>{{ p.name }}</strong>
          <span class="soft small">{{ p.label }}</span>
        </button>
      </li>
    </ul>

    <div ref="el" class="map" aria-label="Map: click to choose the centre of your area"></div>
    <p class="soft small hint">
      <template v-if="model.latitude === null || model.latitude === undefined">Search for a place, or click the map.</template>
      <template v-else>
        Centred on {{ model.label || `${model.latitude.toFixed(3)}, ${model.longitude.toFixed(3)}` }}. Click the map to move it.
      </template>
    </p>

    <div class="radius" role="radiogroup" aria-label="Distance">
      <span class="label">Distance</span>
      <button
        v-for="r in RADII"
        :key="r"
        type="button"
        role="radio"
        :aria-checked="model.radiusKm === r"
        :class="{ on: model.radiusKm === r }"
        @click="setRadius(r)"
      >
        {{ r }} km
      </button>
    </div>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.search .field {
  flex: 1;
  margin-bottom: 0;
}
.places {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  overflow: hidden;
}
.places button {
  display: grid;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  background: var(--paper-raised);
  border: 0;
  border-bottom: 1px solid var(--rule);
  padding: 8px 12px;
  cursor: pointer;
}
.places li:last-child button {
  border-bottom: 0;
}
.places button:hover {
  background: var(--jay-wash);
}
.map {
  height: 300px;
  margin-top: 14px;
  border-radius: var(--radius);
  border: 1px solid var(--rule);
  z-index: 0;
}
.hint {
  margin: 6px 0 12px;
}
.radius {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.radius .label {
  font-weight: 700;
  margin-right: 6px;
}
.radius button {
  font: inherit;
  font-size: var(--step--1);
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink);
  border-radius: 999px;
  padding: 3px 12px;
  cursor: pointer;
}
.radius button.on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
</style>
