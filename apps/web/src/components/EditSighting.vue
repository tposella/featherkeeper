<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api.js';
import { fromLocalInput, toLocalInput } from '../format.js';
import LocationPicker from './LocationPicker.vue';

/**
 * Edit a logged sighting: species, date and time, location, place name, notes.
 * Emits `saved` with the updated sighting, or `close`.
 */
const props = defineProps({
  sighting: { type: Object, required: true },
  catalogue: { type: Object, required: true },
  species: { type: Array, required: true }, // the catalogue's dex
});
const emit = defineEmits(['saved', 'close']);

const speciesId = ref(props.sighting.speciesId);
const speciesQuery = ref('');
const changingSpecies = ref(false);
const observedAt = ref(toLocalInput(props.sighting.observedAt));
const latitude = ref(props.sighting.latitude);
const longitude = ref(props.sighting.longitude);
const locationName = ref(props.sighting.locationName ?? '');
const notes = ref(props.sighting.notes ?? '');
const placeSource = ref('');
const naming = ref(false);
const saving = ref(false);
const error = ref('');

const current = computed(() => props.species.find((s) => s.id === speciesId.value) ?? null);
const matches = computed(() => {
  const q = speciesQuery.value.trim().toLowerCase();
  if (!q) return [];
  return props.species
    .filter((s) => s.commonName.toLowerCase().includes(q) || s.scientificName.toLowerCase().includes(q))
    .slice(0, 8);
});
const moving = computed(() => speciesId.value !== props.sighting.speciesId);
const photoCount = computed(() => props.sighting.photos?.length ?? 0);

function pickSpecies(s) {
  speciesId.value = s.id;
  speciesQuery.value = '';
  changingSpecies.value = false;
}

function onPlaceChosen(place) {
  if (!locationName.value.trim() || placeSource.value) {
    locationName.value = place.name;
    placeSource.value = place.source;
  }
}

async function nameThisPlace() {
  if (latitude.value === null) return;
  naming.value = true;
  try {
    const res = await api.get(`/places/reverse?latitude=${latitude.value}&longitude=${longitude.value}`);
    if (res.suggestion) {
      locationName.value = res.suggestion.name;
      placeSource.value = res.suggestion.source;
    } else {
      placeSource.value = 'none';
    }
  } catch {
    placeSource.value = 'none';
  } finally {
    naming.value = false;
  }
}

// Only send what changed, so the server's "unchanged" values stay exactly as they were.
function changes() {
  const s = props.sighting;
  const body = {};
  if (speciesId.value !== s.speciesId) body.speciesId = speciesId.value;
  const when = fromLocalInput(observedAt.value);
  if (toLocalInput(when) !== toLocalInput(s.observedAt)) body.observedAt = when;
  if (latitude.value !== s.latitude || longitude.value !== s.longitude) {
    body.latitude = latitude.value;
    body.longitude = longitude.value;
  }
  if (locationName.value.trim() !== (s.locationName ?? '')) body.locationName = locationName.value.trim();
  if (notes.value !== (s.notes ?? '')) body.notes = notes.value;
  return body;
}

async function save() {
  error.value = '';
  const body = changes();
  if (!Object.keys(body).length) {
    emit('close');
    return;
  }
  saving.value = true;
  try {
    const res = await api.patch(`/sightings/${props.sighting.id}`, body);
    emit('saved', res.sighting);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

const first = ref(null);
let lastFocus = null;
function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(async () => {
  lastFocus = document.activeElement;
  window.addEventListener('keydown', onKey);
  await nextTick();
  first.value?.focus();
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  lastFocus?.focus?.();
});
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Edit sighting" @click.self="emit('close')">
    <form class="panel" @submit.prevent="save">
      <header>
        <h3>Edit sighting</h3>
        <button class="btn quiet" type="button" @click="emit('close')">Cancel</button>
      </header>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>

      <section>
        <h4>Species</h4>
        <div v-if="!changingSpecies" class="chosen">
          <img v-if="current?.coverUrl" :src="current.coverUrl" alt="" />
          <span>
            <strong>{{ current?.commonName }}</strong>
            <span class="sci soft">{{ current?.scientificName }}</span>
          </span>
          <button class="btn quiet" type="button" @click="changingSpecies = true">Change species</button>
        </div>
        <div v-else>
          <label class="field">
            <span>Find a species in this catalogue</span>
            <input v-model="speciesQuery" type="search" placeholder="Type a common or scientific name" autocomplete="off" />
          </label>
          <ul v-if="matches.length" class="matches">
            <li v-for="s in matches" :key="s.id">
              <button type="button" @click="pickSpecies(s)">
                {{ s.commonName }} <span class="sci soft small">{{ s.scientificName }}</span>
              </button>
            </li>
          </ul>
          <button class="btn quiet small" type="button" @click="(changingSpecies = false), (speciesQuery = '')">
            Keep {{ current?.commonName }}
          </button>
        </div>
        <p v-if="moving" class="notice small">
          This sighting<template v-if="photoCount"> and its {{ photoCount }} photo{{ photoCount === 1 ? '' : 's' }}</template>
          will move to {{ current?.commonName }}.
        </p>
      </section>

      <section>
        <h4>When and where</h4>
        <label class="field">
          <span>Date and time</span>
          <span class="date-row">
            <input ref="first" v-model="observedAt" type="datetime-local" />
            <button v-if="observedAt" class="btn quiet small" type="button" @click="observedAt = ''">Clear</button>
          </span>
        </label>
        <LocationPicker
          v-model:latitude="latitude"
          v-model:longitude="longitude"
          :near="latitude === null ? null : { latitude, longitude }"
          :catalogue="catalogue.slug"
          @place="onPlaceChosen"
        />
        <label class="field place">
          <span>Place name</span>
          <span class="place-row">
            <input v-model="locationName" type="text" maxlength="300" @input="placeSource = ''" />
            <button class="btn" type="button" :disabled="latitude === null || naming" @click="nameThisPlace">
              {{ naming ? 'Looking up...' : 'Name this place' }}
            </button>
          </span>
          <span v-if="placeSource === 'hotspot'" class="hint">Named after the nearest eBird hotspot.</span>
          <span v-else-if="placeSource === 'map'" class="hint">Named from OpenStreetMap.</span>
          <span v-else-if="placeSource === 'none'" class="hint">No named place found near the pin.</span>
        </label>
      </section>

      <section>
        <label class="field">
          <span>Notes</span>
          <textarea v-model="notes" maxlength="10000"></textarea>
        </label>
      </section>

      <footer>
        <button class="btn primary" type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save changes' }}</button>
        <button class="btn quiet" type="button" @click="emit('close')">Cancel</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(10 14 12 / 0.6);
  display: grid;
  place-items: start center;
  padding: 24px 16px;
  overflow: auto;
}
.panel {
  width: min(760px, 100%);
  background: var(--paper);
  border-radius: var(--radius);
  padding: 18px 22px 20px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
}
header,
footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
footer {
  justify-content: flex-start;
  margin-top: 8px;
}
h3 {
  margin: 0;
}
h4 {
  font-family: var(--font-display);
  font-size: var(--step-1);
  margin: 0 0 8px;
}
section {
  margin-top: 20px;
}
.chosen {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  border-radius: var(--radius);
}
.chosen img {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
}
.chosen > span {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
  align-items: baseline;
}
.matches {
  list-style: none;
  padding: 0;
  margin: 0 0 8px;
  display: grid;
  gap: 6px;
}
.matches button {
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  padding: 8px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  cursor: pointer;
}
.matches button:hover {
  background: var(--jay-wash);
}
.date-row,
.place-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.date-row input,
.place-row input {
  flex: 1;
}
.place {
  margin-top: 12px;
}
.notice {
  margin: 10px 0 0;
}
</style>
