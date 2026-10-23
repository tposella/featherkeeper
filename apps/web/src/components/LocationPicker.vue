<script setup>
import L from 'leaflet';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';
import { TILE_ATTRIBUTION, TILE_URL } from '../map-tiles.js';

// v-model:latitude / v-model:longitude. Click the map to place the pin.
const latitude = defineModel('latitude', { default: null });
const longitude = defineModel('longitude', { default: null });
// Where to centre the map before a pin is placed, e.g. the catalogue's latest sighting.
// catalogue: slug, so the search can put eBird hotspots near that catalogue first.
const props = defineProps({ near: { type: Object, default: null }, catalogue: { type: String, default: null } });
// Emitted when a search result is chosen, so the form can use its name: { name, source }.
const emit = defineEmits(['place']);

// ---- Search for a place --------------------------------------------------------
const query = ref('');
const results = ref([]);
const searching = ref(false);
const searchMsg = ref('');
const chosen = ref('');

async function search() {
  const q = query.value.trim();
  searchMsg.value = '';
  results.value = [];
  if (q.length < 2) return;
  searching.value = true;
  try {
    const params = new URLSearchParams({ q, ...(props.catalogue ? { catalogue: props.catalogue } : {}) });
    results.value = (await api.get(`/places?${params}`)).places;
    if (!results.value.length) searchMsg.value = 'No places found. Try a nearby town, or add the province.';
  } catch (err) {
    searchMsg.value = err.message;
  } finally {
    searching.value = false;
  }
}

function choose(p) {
  latitude.value = round(p.latitude);
  longitude.value = round(p.longitude);
  chosen.value = p.name;
  query.value = '';
  results.value = [];
  emit('place', { name: p.name, source: p.source });
}

const el = ref(null);
const locating = ref(false);
const geoError = ref('');
let map;
let marker;

const round = (n) => Math.round(n * 1e6) / 1e6;

function placeMarker(fly = false) {
  if (!map) return;
  if (latitude.value === null || longitude.value === null) {
    marker?.remove();
    marker = null;
    return;
  }
  const at = [latitude.value, longitude.value];
  if (!marker) {
    marker = L.circleMarker(at, { radius: 9, color: '#1e2a23', weight: 2, fillColor: '#2c6a8a', fillOpacity: 0.9 }).addTo(map);
  } else {
    marker.setLatLng(at);
  }
  if (fly) map.setView(at, Math.max(map.getZoom(), 13));
}

onMounted(() => {
  map = L.map(el.value, { scrollWheelZoom: false }).setView([54, -100], 3);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
  map.on('click', (e) => {
    latitude.value = round(e.latlng.lat);
    longitude.value = round(e.latlng.lng);
  });
  placeMarker(true);
  // In a dialog the map can mount before its box has its final size.
  setTimeout(() => map?.invalidateSize(), 60);
});
onUnmounted(() => map?.remove());

watch([latitude, longitude], () => placeMarker(true));
watch(
  () => props.near,
  (near) => {
    if (map && near && latitude.value === null) map.setView([near.latitude, near.longitude], 10);
  },
);

function useMyLocation() {
  geoError.value = '';
  if (!navigator.geolocation) {
    geoError.value = 'This browser cannot share its location.';
    return;
  }
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latitude.value = round(pos.coords.latitude);
      longitude.value = round(pos.coords.longitude);
      locating.value = false;
    },
    (err) => {
      geoError.value = err.code === 1 ? 'Location permission was denied.' : 'Could not get your location.';
      locating.value = false;
    },
    { enableHighAccuracy: true, timeout: 15000 },
  );
}

function clear() {
  latitude.value = null;
  longitude.value = null;
  chosen.value = '';
}

function onNumber(which, event) {
  const v = event.target.value === '' ? null : Number(event.target.value);
  if (which === 'lat') latitude.value = Number.isFinite(v) ? v : null;
  else longitude.value = Number.isFinite(v) ? v : null;
}
</script>

<template>
  <div class="picker">
    <!-- Not a <form>: this sits inside the sighting form, and Enter must search, not save. -->
    <div v-if="session.config.placeSearchEnabled !== false" class="search" role="search">
      <label class="field">
        <span>Search for a place</span>
        <span class="search-row">
          <input
            v-model="query"
            type="search"
            placeholder="A park, hotspot, lake or town"
            autocomplete="off"
            @keydown.enter.prevent="search"
          />
          <button class="btn" type="button" :disabled="searching || query.trim().length < 2" @click="search">
            {{ searching ? 'Searching...' : 'Search' }}
          </button>
        </span>
      </label>
      <p v-if="searchMsg" class="soft small" role="status">{{ searchMsg }}</p>
      <ul v-if="results.length" class="results">
        <li v-for="p in results" :key="`${p.source}:${p.latitude},${p.longitude}`">
          <button type="button" @click="choose(p)">
            <span class="name">
              <strong>{{ p.name }}</strong>
              <span v-if="p.source === 'hotspot'" class="tag small">eBird hotspot</span>
            </span>
            <span class="soft small">{{ p.label }}</span>
          </button>
        </li>
      </ul>
    </div>

    <div ref="el" class="map" aria-label="Map: click to set the sighting location"></div>
    <p class="soft small hint">
      <template v-if="latitude === null">Search above, click the map, or use your current location.</template>
      <template v-else>
        Pin at {{ latitude.toFixed(5) }}, {{ longitude.toFixed(5) }}<template v-if="chosen"> ({{ chosen }})</template>. Click
        the map to move it.
      </template>
    </p>
    <div class="row">
      <button class="btn" type="button" :disabled="locating" @click="useMyLocation">
        {{ locating ? 'Finding you...' : 'Use my location' }}
      </button>
      <button v-if="latitude !== null" class="btn quiet" type="button" @click="clear">Clear location</button>
      <span v-if="geoError" class="soft small" role="status">{{ geoError }}</span>
    </div>
    <details class="coords-box">
      <summary class="small">Enter coordinates</summary>
      <div class="row coords">
        <label class="field">
          <span>Latitude</span>
          <input type="number" step="any" min="-90" max="90" :value="latitude ?? ''" @change="onNumber('lat', $event)" />
        </label>
        <label class="field">
          <span>Longitude</span>
          <input type="number" step="any" min="-180" max="180" :value="longitude ?? ''" @change="onNumber('lng', $event)" />
        </label>
      </div>
    </details>
  </div>
</template>

<style scoped>
.map {
  height: 280px;
  border-radius: var(--radius);
  border: 1px solid var(--rule);
  margin-bottom: 12px;
  z-index: 0;
}
.coords .field {
  margin-bottom: 8px;
}
.search .field {
  margin-bottom: 6px;
}
.search-row {
  display: flex;
  gap: 8px;
}
.search-row input {
  flex: 1;
}
.results {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  overflow: hidden;
}
.results button {
  display: grid;
  gap: 2px;
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
.results li:last-child button {
  border-bottom: 0;
}
.results button:hover,
.results button:focus-visible {
  background: var(--jay-wash);
}
.name {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.tag {
  color: var(--jay);
  border: 1px solid var(--jay);
  border-radius: 999px;
  padding: 0 8px;
}
.hint {
  margin: -4px 0 10px;
}
.coords-box {
  margin-top: 12px;
}
.coords-box summary {
  cursor: pointer;
  color: var(--jay);
  font-weight: 700;
}
.coords-box .coords {
  margin-top: 8px;
}
</style>
