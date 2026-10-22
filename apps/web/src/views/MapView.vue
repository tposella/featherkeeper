<script setup>
import L from 'leaflet';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import { formatDate } from '../format.js';
import { TILE_ATTRIBUTION, TILE_URL } from '../map-tiles.js';

const { catalogue } = useCatalogue();
const router = useRouter();
const el = ref(null);
const sightings = ref([]);
const hidden = ref(false);
const error = ref('');
let map;

const placed = computed(() => sightings.value.filter((s) => s.latitude !== null));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

onMounted(async () => {
  try {
    const res = await api.get(`/catalogues/${catalogue.value.slug}/sightings`);
    sightings.value = res.sightings;
    hidden.value = res.locationsHidden;
  } catch (err) {
    error.value = err.message;
    return;
  }
  if (!el.value) return;

  map = L.map(el.value, { preferCanvas: true }).setView([54, -100], 3);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

  const points = [];
  for (const s of placed.value) {
    const photographed = s.photoCount > 0;
    const marker = L.circleMarker([s.latitude, s.longitude], {
      radius: 7,
      color: '#1e2a23',
      weight: 1.5,
      fillColor: photographed ? '#2c6a8a' : '#c4912a',
      fillOpacity: 0.9,
    }).addTo(map);
    const img = s.thumbUrl ? `<img src="${escapeHtml(s.thumbUrl)}" alt="" width="120" height="120" style="object-fit:cover;border-radius:4px;display:block;margin-bottom:6px">` : '';
    const href = router.resolve({ name: 'species', params: { slug: catalogue.value.slug, speciesId: s.speciesId } }).href;
    marker.bindPopup(
      `${img}<a href="${escapeHtml(href)}" data-spa><strong>${escapeHtml(s.commonName)}</strong></a><br>` +
        `<span>${escapeHtml(formatDate(s.observedAt) || 'Date not recorded')}</span>` +
        (s.locationName ? `<br><span>${escapeHtml(s.locationName)}</span>` : ''),
    );
    points.push([s.latitude, s.longitude]);
  }
  if (points.length === 1) map.setView(points[0], 12);
  else if (points.length > 1) map.fitBounds(points, { padding: [32, 32], maxZoom: 13 });

  // Keep popup links inside the single-page app.
  map.on('popupopen', (e) => {
    const link = e.popup.getElement()?.querySelector('a[data-spa]');
    link?.addEventListener('click', (ev) => {
      ev.preventDefault();
      router.push(link.getAttribute('href'));
    });
  });
});

onUnmounted(() => map?.remove());
</script>

<template>
  <div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <p v-else-if="hidden" class="notice">The owner of this catalogue keeps sighting locations private.</p>
    <template v-else>
      <p class="soft legend small">
        <span class="dot photo"></span> Photographed
        <span class="dot logged"></span> Seen, no photo
        <span class="count">{{ placed.length }} of {{ sightings.length }} sightings have a location.</span>
      </p>
      <div ref="el" class="map" aria-label="Map of sightings"></div>
    </template>
  </div>
</template>

<style scoped>
.map {
  height: min(70vh, 640px);
  border-radius: var(--radius);
  border: 1px solid var(--rule);
  z-index: 0;
}
.legend {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--ink);
  display: inline-block;
}
.dot.photo {
  background: #2c6a8a;
}
.dot.logged {
  background: #c4912a;
  margin-left: 12px;
}
.count {
  margin-left: auto;
}
</style>
