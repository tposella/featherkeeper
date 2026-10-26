<script setup>
import { computed, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import AiSuggestions from '../components/AiSuggestions.vue';
import LocationPicker from '../components/LocationPicker.vue';
import { readPhotoMetadata } from '../exif.js';
import { describeDuplicate, markDuplicates } from '../duplicates.js';
import { formatDate, fromLocalInput } from '../format.js';
import { session } from '../session.js';

const { catalogue, species, reload, reloadDex } = useCatalogue();
const route = useRoute();
const router = useRouter();

const files = ref([]); // [{ file, url }]
const speciesId = ref(Number(route.query.species) || null);
const speciesQuery = ref('');
const observedAt = ref('');
const latitude = ref(null);
const longitude = ref(null);
const locationName = ref('');
const notes = ref('');
// What was read from the photos: { date, location, camera, names, checked }.
const fromPhoto = ref(null);
const naming = ref(false);
const placeSource = ref(''); // 'hotspot' | 'map' | 'none'
const error = ref('');
const progress = ref('');
const busy = ref(false);

// Centre the location map on the catalogue's most recent sighting with coordinates.
const near = ref(null);
api
  .get(`/catalogues/${catalogue.value.slug}/sightings?limit=1&located=1`)
  .then((res) => {
    near.value = res.sightings[0] ?? null;
  })
  .catch(() => {});

// AI identification of the first photo: what was suggested and what the user decided.
const aiDecision = ref(null);
const speciesSearch = ref(null);
const firstFile = computed(() => files.value[0]?.file ?? null);

const selected = computed(() => species.value.find((s) => s.id === speciesId.value) ?? null);
const matches = computed(() => {
  const q = speciesQuery.value.trim().toLowerCase();
  if (!q) return [];
  return species.value
    .filter((s) => s.commonName.toLowerCase().includes(q) || s.scientificName.toLowerCase().includes(q))
    .slice(0, 8);
});

const ACCEPT = 'image/jpeg,image/heic,image/heif,.heic,.heif,image/png,image/webp,image/tiff,image/avif';

async function onFiles(event) {
  const picked = [...(event.target.files ?? [])];
  event.target.value = '';
  if (!picked.length) return;
  const maxBytes = session.config.maxUploadMb > 0 ? session.config.maxUploadMb * 1024 * 1024 : Infinity;
  const tooBig = picked.filter((f) => f.size > maxBytes);
  if (tooBig.length) error.value = `${tooBig.map((f) => f.name).join(', ')} is larger than ${session.config.maxUploadMb} MB and was skipped.`;
  const ok = picked.filter((f) => f.size <= maxBytes);
  const added = ok.map((file) => ({ file, url: URL.createObjectURL(file), duplicates: null }));
  files.value.push(...added);
  // Warn about photos already in this catalogue (runs alongside the metadata reading below).
  if (added.length) markDuplicates(catalogue.value.slug, files.value.slice(-added.length));

  // Prefill from the photos' metadata without overwriting what the user typed. Date and location
  // can come from different photos (e.g. a phone shot with GPS next to a camera shot without).
  const found = { date: null, location: null, camera: '', names: [] };
  for (const file of ok) {
    let meta = await readPhotoMetadata(file);
    // Browsers can't read HEIC (iPhone) metadata, so the server reads it for those.
    if (/\.hei[cf]$/i.test(file.name) || /hei[cf]/.test(file.type)) {
      if (!meta.localDateTime && meta.latitude === null) {
        try {
          meta = { ...meta, ...(await api.upload('/photo-info', file)) };
          meta.camera = meta.camera || '';
        } catch {
          /* the server fills in date and place when the photo is saved */
        }
      }
    }
    if (!found.camera && meta.camera) found.camera = meta.camera;
    if (!found.date && meta.localDateTime) {
      found.date = meta.localDateTime;
      found.names.push(file.name);
    }
    if (!found.location && meta.latitude !== null) {
      found.location = { latitude: meta.latitude, longitude: meta.longitude };
      if (!found.names.includes(file.name)) found.names.push(file.name);
    }
    if (found.date && found.location) break;
  }
  if (found.date && !observedAt.value) observedAt.value = found.date;
  if (found.location && latitude.value === null) {
    latitude.value = found.location.latitude;
    longitude.value = found.location.longitude;
  }
  fromPhoto.value = { ...found, checked: ok.length };
  if (found.location && !locationName.value.trim()) await nameThisPlace();
}

// A place picked from the search: use its name unless the user has typed their own.
function onPlaceChosen(place) {
  if (!locationName.value.trim() || placeSource.value) {
    locationName.value = place.name;
    placeSource.value = place.source;
  }
}

// Turn the pin into a place name: the nearest eBird hotspot within 1 km, otherwise a park or town.
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

function removeFile(i) {
  URL.revokeObjectURL(files.value[i].url);
  files.value.splice(i, 1);
  aiDecision.value = null;
}
onUnmounted(() => files.value.forEach((f) => URL.revokeObjectURL(f.url)));

function choose(s) {
  speciesId.value = s.id;
  speciesQuery.value = '';
}

function onAccepted(id) {
  speciesId.value = id;
  speciesQuery.value = '';
  reloadDex();
}

function onNoneOfThese() {
  speciesId.value = null;
  speciesSearch.value?.focus();
}

async function save() {
  error.value = '';
  // A sighting is a photo of a bird: at least one photo is needed.
  if (!files.value.length) {
    error.value = 'Add at least one photo of the bird.';
    return;
  }
  if (!speciesId.value) {
    error.value = 'Choose which species you saw.';
    return;
  }
  busy.value = true;
  let sightingId = null;
  try {
    const { sighting } = await api.post(`/catalogues/${catalogue.value.slug}/sightings`, {
      speciesId: speciesId.value,
      observedAt: fromLocalInput(observedAt.value),
      latitude: latitude.value,
      longitude: longitude.value,
      locationName: locationName.value,
      notes: notes.value,
    });
    sightingId = sighting.id;
    let uploaded = 0;
    try {
      for (let i = 0; i < files.value.length; i += 1) {
        progress.value = `Uploading photo ${i + 1} of ${files.value.length}...`;
        const fields = i === 0 && aiDecision.value ? { ai: JSON.stringify(aiDecision.value) } : {};
        await api.upload(`/sightings/${sightingId}/photos`, files.value[i].file, fields);
        uploaded += 1;
      }
    } catch (err) {
      // No photo made it: don't leave a sighting without one behind.
      if (!uploaded) {
        await api.del(`/sightings/${sightingId}`).catch(() => {});
        sightingId = null;
      }
      throw err;
    }
    await Promise.all([reload(), reloadDex()]);
    router.push({ name: 'species', params: { slug: catalogue.value.slug, speciesId: speciesId.value } });
  } catch (err) {
    error.value = sightingId
      ? `The sighting was saved, but a photo failed to upload: ${err.message} You can add it from the species page.`
      : err.message;
  } finally {
    busy.value = false;
    progress.value = '';
  }
}
</script>

<template>
  <p v-if="!catalogue.access.canEdit" class="notice">Only the owner and editors can log sightings in this catalogue.</p>
  <form v-else class="log" @submit.prevent="save">
    <h2>Log a sighting</h2>
    <p class="soft small bulk-link">
      Back from a shoot with lots of photos?
      <RouterLink :to="{ name: 'log-bulk', params: { slug: catalogue.slug } }">Upload them all at once</RouterLink>.
    </p>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <section>
      <h3>Photos</h3>
      <ul v-if="files.length" class="previews">
        <li v-for="(f, i) in files" :key="f.url">
          <!-- Most browsers can't show HEIC (iPhone) photos; they upload fine, so show a stand-in. -->
          <img v-if="!f.noPreview" :src="f.url" :alt="f.file.name" @error="f.noPreview = true" />
          <span v-else class="no-preview small" :title="f.file.name">
            <strong>{{ /\.hei[cf]$/i.test(f.file.name) ? 'HEIC photo' : 'Photo' }}</strong>
            {{ f.file.name }}
          </span>
          <p v-if="f.duplicates" class="dup small" role="note">Already uploaded: {{ describeDuplicate(f.duplicates) }}</p>
          <button class="btn quiet small" type="button" @click="removeFile(i)">Remove</button>
        </li>
      </ul>
      <label class="btn">
        {{ files.length ? 'Add more photos' : 'Choose photos' }}
        <input class="visually-hidden" type="file" :accept="ACCEPT" multiple @change="onFiles" />
      </label>
      <p class="soft small hint">
        At least one photo. JPEG, HEIC (iPhone), PNG, WebP, TIFF or AVIF<template v-if="session.config.maxUploadMb > 0">, up to
        {{ session.config.maxUploadMb }} MB each</template>. Date and GPS are read from the photo.
      </p>
      <div v-if="fromPhoto" class="from-photo small" role="status">
        <template v-if="fromPhoto.date || fromPhoto.location">
          <strong>From the photo:</strong>
          <span v-if="fromPhoto.date">{{ formatDate(fromPhoto.date, true) }}</span>
          <span v-if="fromPhoto.location">
            {{ fromPhoto.location.latitude.toFixed(5) }}, {{ fromPhoto.location.longitude.toFixed(5) }}
          </span>
          <span v-if="fromPhoto.camera" class="soft">{{ fromPhoto.camera }}</span>
          <span v-if="!fromPhoto.location" class="warn">
            No GPS location in {{ fromPhoto.checked === 1 ? 'this photo' : 'these photos' }}; set the pin on the map below.
          </span>
          <span v-if="!fromPhoto.date" class="warn">No date in the photo; enter it below.</span>
        </template>
        <template v-else>
          <strong>No date or location found in {{ fromPhoto.checked === 1 ? 'this photo' : 'these photos' }}.</strong>
          Phones often remove location when sharing a photo, and editing apps can strip it on export (in Lightroom,
          check that Metadata includes location). Enter them below instead.
        </template>
      </div>
    </section>

    <section>
      <h3>Species</h3>
      <AiSuggestions
        v-if="session.config.identifyEnabled && firstFile"
        :catalogue="catalogue.slug"
        :file="firstFile"
        :latitude="latitude"
        :longitude="longitude"
        :selected-species-id="speciesId"
        @accepted="onAccepted"
        @decision="aiDecision = $event"
        @none="onNoneOfThese"
      />

      <div v-if="selected" class="chosen">
        <img v-if="selected.coverUrl" :src="selected.coverUrl" alt="" />
        <span>
          <strong>{{ selected.commonName }}</strong>
          <span class="sci soft"> {{ selected.scientificName }}</span>
        </span>
        <button class="btn quiet" type="button" @click="speciesId = null">Change</button>
      </div>
      <div v-else class="combo">
        <label class="field">
          <span>Find a species in this catalogue</span>
          <input
            ref="speciesSearch"
            v-model="speciesQuery"
            type="search"
            placeholder="Type a common or scientific name"
            autocomplete="off"
          />
        </label>
        <ul v-if="matches.length" class="matches">
          <li v-for="s in matches" :key="s.id">
            <button type="button" @click="choose(s)">
              {{ s.commonName }} <span class="sci soft small">{{ s.scientificName }}</span>
            </button>
          </li>
        </ul>
        <p v-else-if="speciesQuery" class="soft small">
          No match. Add it under
          <RouterLink :to="{ name: 'settings', params: { slug: catalogue.slug }, hash: '#species' }">Settings</RouterLink>
          first.
        </p>
      </div>
    </section>

    <section>
      <h3>When and where</h3>
      <label class="field">
        <span>Date and time</span>
        <input v-model="observedAt" type="datetime-local" />
      </label>
      <LocationPicker
        v-model:latitude="latitude"
        v-model:longitude="longitude"
        :near="near"
        :catalogue="catalogue.slug"
        @place="onPlaceChosen"
      />
      <label class="field place">
        <span>Place name</span>
        <span class="place-row">
          <input v-model="locationName" type="text" maxlength="300" placeholder="Glenbow Ranch, west trail" @input="placeSource = ''" />
          <button class="btn" type="button" :disabled="latitude === null || naming" @click="nameThisPlace">
            {{ naming ? 'Looking up...' : 'Name this place' }}
          </button>
        </span>
        <span v-if="placeSource === 'hotspot'" class="hint">Named after the nearest eBird hotspot. Edit it if you like.</span>
        <span v-else-if="placeSource === 'map'" class="hint">Named from OpenStreetMap. Edit it if you like.</span>
        <span v-else-if="placeSource === 'none'" class="hint">No named place found near the pin; type one in.</span>
      </label>
      <p v-if="catalogue.hideLocations" class="soft small">
        This catalogue hides exact locations from viewers. Only you and other editors see the map pin.
      </p>
    </section>

    <section>
      <label class="field">
        <span>Notes</span>
        <textarea v-model="notes" maxlength="10000" placeholder="Behaviour, plumage, weather..."></textarea>
      </label>
    </section>

    <div class="row">
      <button class="btn primary" type="submit" :disabled="busy">Save sighting</button>
      <span v-if="progress" class="soft" role="status">{{ progress }}</span>
    </div>
  </form>
</template>

<style scoped>
.log {
  max-width: 760px;
}
section {
  margin-bottom: 32px;
}
.hint {
  margin-top: 8px;
}
label.btn {
  cursor: pointer;
}
.previews {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.previews li {
  display: grid;
  justify-items: start;
}
.previews img {
  width: 132px;
  height: 132px;
  object-fit: cover;
  border-radius: var(--radius);
}
.dup {
  max-width: 132px;
  margin: 4px 0 0;
  padding: 2px 6px;
  border-radius: var(--radius);
  background: var(--goldfinch-wash);
  color: var(--ink);
}
.no-preview {
  width: 132px;
  height: 132px;
  display: grid;
  align-content: center;
  gap: 4px;
  padding: 10px;
  border-radius: var(--radius);
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-soft);
  text-align: center;
  overflow-wrap: anywhere;
}
.no-preview strong {
  color: var(--ink);
}
.matches {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
  display: grid;
  gap: 6px;
}
.matches button {
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  cursor: pointer;
}
.chosen {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--jay);
  background: var(--jay-wash);
  border-radius: var(--radius);
}
.chosen img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
}
.chosen > span {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
}
.place {
  margin-top: 12px;
}
.place-row {
  display: flex;
  gap: 8px;
}
.place-row input {
  flex: 1;
}
.from-photo {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 12px;
  padding: 10px 12px;
  border-left: 4px solid var(--jay);
  background: var(--jay-wash);
  border-radius: 0 var(--radius) var(--radius) 0;
}
.from-photo .warn {
  flex-basis: 100%;
  color: var(--ink);
}
</style>
