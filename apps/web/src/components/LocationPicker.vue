<script setup>
import L from 'leaflet';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { TILE_ATTRIBUTION, TILE_URL } from '../map-tiles.js';

// v-model:latitude / v-model:longitude. Click the map to place the pin.
const latitude = defineModel('latitude', { default: null });
const longitude = defineModel('longitude', { default: null });

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
});
onUnmounted(() => map?.remove());

watch([latitude, longitude], () => placeMarker(true));

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
}

function onNumber(which, event) {
  const v = event.target.value === '' ? null : Number(event.target.value);
  if (which === 'lat') latitude.value = Number.isFinite(v) ? v : null;
  else longitude.value = Number.isFinite(v) ? v : null;
}
</script>

<template>
  <div class="picker">
    <div ref="el" class="map" aria-label="Map: click to set the sighting location"></div>
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
    <div class="row">
      <button class="btn" type="button" :disabled="locating" @click="useMyLocation">
        {{ locating ? 'Finding you...' : 'Use my location' }}
      </button>
      <button v-if="latitude !== null" class="btn quiet" type="button" @click="clear">Clear location</button>
      <span v-if="geoError" class="soft small" role="status">{{ geoError }}</span>
    </div>
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
</style>
