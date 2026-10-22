<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import { formatDate, plateNumber } from '../format.js';

const props = defineProps({ speciesId: { type: Number, required: true } });
const { catalogue, species, reload, reloadDex } = useCatalogue();
const router = useRouter();

const entry = ref(null);
const sightings = ref([]);
const error = ref('');
const notes = ref('');
const editingNotes = ref(false);
const lightbox = ref(null);
const uploadingFor = ref(null);

const canEdit = computed(() => catalogue.value.access.canEdit);
const plate = computed(() => species.value.findIndex((s) => s.id === props.speciesId) + 1);
const allPhotos = computed(() => sightings.value.flatMap((s) => s.photos));
const cover = computed(() => {
  const url = entry.value?.coverUrl;
  if (!url) return null;
  return allPhotos.value.find((p) => p.urls.thumb === url) ?? null;
});

async function load() {
  try {
    const res = await api.get(`/catalogues/${catalogue.value.slug}/species/${props.speciesId}`);
    entry.value = res.entry;
    sightings.value = res.sightings;
    notes.value = res.entry.notes;
  } catch (err) {
    error.value = err.status === 404 ? 'That species is not in this catalogue.' : err.message;
  }
}
onMounted(load);

// Lightbox: focus the close button on open, close on Escape, return focus afterwards.
const closeBtn = ref(null);
let lastFocus = null;
watch(lightbox, async (open, wasOpen) => {
  if (open && !wasOpen) {
    lastFocus = document.activeElement;
    await nextTick();
    closeBtn.value?.focus();
  } else if (!open && wasOpen) {
    lastFocus?.focus?.();
  }
});
function onKey(e) {
  if (e.key === 'Escape' && lightbox.value) lightbox.value = null;
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

async function refreshAll() {
  await Promise.all([load(), reloadDex(), reload()]);
}

async function saveNotes() {
  try {
    await api.patch(`/catalogues/${catalogue.value.slug}/species/${props.speciesId}`, { notes: notes.value });
    entry.value.notes = notes.value;
    editingNotes.value = false;
  } catch (err) {
    error.value = err.message;
  }
}

async function setCover(photo) {
  try {
    await api.patch(`/catalogues/${catalogue.value.slug}/species/${props.speciesId}`, { coverPhotoId: photo.id });
    await refreshAll();
  } catch (err) {
    error.value = err.message;
  }
}

async function deletePhoto(photo) {
  if (!confirm('Delete this photo? This cannot be undone.')) return;
  try {
    await api.del(`/photos/${photo.id}`);
    lightbox.value = null;
    await refreshAll();
  } catch (err) {
    error.value = err.message;
  }
}

async function deleteSighting(s) {
  const n = s.photos.length;
  const msg = n ? `Delete this sighting and its ${n} photo${n === 1 ? '' : 's'}?` : 'Delete this sighting?';
  if (!confirm(msg)) return;
  try {
    await api.del(`/sightings/${s.id}`);
    await refreshAll();
  } catch (err) {
    error.value = err.message;
  }
}

async function addPhotos(s, event) {
  const files = [...(event.target.files ?? [])];
  event.target.value = '';
  if (!files.length) return;
  uploadingFor.value = s.id;
  error.value = '';
  try {
    for (const file of files) await api.upload(`/sightings/${s.id}/photos`, file);
  } catch (err) {
    error.value = err.message;
  } finally {
    uploadingFor.value = null;
    await refreshAll();
  }
}

async function removeFromDex() {
  if (!confirm(`Remove ${entry.value.commonName} from this catalogue?`)) return;
  try {
    await api.del(`/catalogues/${catalogue.value.slug}/species/${props.speciesId}`);
    await Promise.all([reloadDex(), reload()]);
    router.push({ name: 'dex', params: { slug: catalogue.value.slug } });
  } catch (err) {
    error.value = err.message;
  }
}

function place(s) {
  if (s.locationName) return s.locationName;
  if (s.latitude !== null) return `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}`;
  return '';
}

function exifLine(p) {
  const e = p.exif ?? {};
  const parts = [p.camera, p.lens];
  if (e.focalLength) parts.push(`${e.focalLength} mm`);
  if (e.fNumber) parts.push(`f/${e.fNumber}`);
  if (e.exposureTime) parts.push(e.exposureTime < 1 ? `1/${Math.round(1 / e.exposureTime)} s` : `${e.exposureTime} s`);
  if (e.iso) parts.push(`ISO ${e.iso}`);
  return parts.filter(Boolean).join(', ');
}
</script>

<template>
  <div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <template v-if="entry">
      <section class="hero">
        <div class="hero-photo" :class="entry.status">
          <img v-if="entry.coverUrl" :src="cover ? cover.urls.display : entry.coverUrl" alt="" />
          <span v-else class="soft">{{ entry.status === 'logged' ? 'Seen, not yet photographed' : 'Not yet photographed' }}</span>
        </div>
        <div class="hero-text">
          <p class="no">{{ plate > 0 ? plateNumber(plate) : '' }}</p>
          <h2 class="common">{{ entry.commonName }}</h2>
          <p class="sci">{{ entry.scientificName }}</p>
          <dl class="facts">
            <template v-if="entry.familyCommon || entry.familyScientific">
              <dt>Family</dt>
              <dd>
                {{ entry.familyCommon }}
                <span v-if="entry.familyScientific" class="sci soft">({{ entry.familyScientific }})</span>
              </dd>
            </template>
            <template v-if="entry.taxonOrder">
              <dt>Order</dt>
              <dd>{{ entry.taxonOrder }}</dd>
            </template>
            <dt>Sightings</dt>
            <dd>{{ entry.sightingCount }}, with {{ entry.photoCount }} photo{{ entry.photoCount === 1 ? '' : 's' }}</dd>
            <template v-if="entry.firstObserved">
              <dt>First seen</dt>
              <dd>{{ formatDate(entry.firstObserved) }}</dd>
            </template>
          </dl>
          <div class="row">
            <RouterLink
              v-if="canEdit"
              :to="{ name: 'log', params: { slug: catalogue.slug }, query: { species: entry.id } }"
              class="btn primary"
            >
              Log a sighting
            </RouterLink>
            <a
              v-if="entry.ebirdCode"
              :href="`https://ebird.org/species/${entry.ebirdCode}`"
              target="_blank"
              rel="noopener"
              class="btn quiet"
            >
              Species page on eBird
            </a>
          </div>
        </div>
      </section>

      <section class="notes">
        <h3>Notes</h3>
        <template v-if="editingNotes">
          <textarea v-model="notes" maxlength="10000" aria-label="Notes"></textarea>
          <div class="row">
            <button class="btn primary" type="button" @click="saveNotes">Save notes</button>
            <button class="btn quiet" type="button" @click="(editingNotes = false), (notes = entry.notes)">Cancel</button>
          </div>
        </template>
        <template v-else>
          <p v-if="entry.notes" class="pre">{{ entry.notes }}</p>
          <p v-else class="soft">No notes yet.</p>
          <button v-if="canEdit" class="btn" type="button" @click="editingNotes = true">
            {{ entry.notes ? 'Edit notes' : 'Add notes' }}
          </button>
        </template>
      </section>

      <section>
        <h3>Sightings</h3>
        <p v-if="!sightings.length" class="empty">No sightings logged for this species yet.</p>
        <ol class="sightings">
          <li v-for="s in sightings" :key="s.id" class="sighting">
            <div class="s-head">
              <div>
                <strong>{{ s.observedAt ? formatDate(s.observedAt, true) : 'Date not recorded' }}</strong>
                <span v-if="place(s)" class="soft">, {{ place(s) }}</span>
                <span v-if="s.createdBy" class="soft small"> (logged by {{ s.createdBy }})</span>
              </div>
              <div v-if="canEdit" class="row">
                <label class="btn quiet">
                  {{ uploadingFor === s.id ? 'Uploading...' : 'Add photos' }}
                  <input
                    class="visually-hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/tiff,image/avif"
                    multiple
                    :disabled="uploadingFor === s.id"
                    @change="addPhotos(s, $event)"
                  />
                </label>
                <button class="btn quiet danger-text" type="button" @click="deleteSighting(s)">Delete</button>
              </div>
            </div>
            <p v-if="s.notes" class="pre">{{ s.notes }}</p>
            <ul v-if="s.photos.length" class="strip">
              <li v-for="p in s.photos" :key="p.id">
                <button type="button" class="thumb" @click="lightbox = p">
                  <img :src="p.urls.thumb" alt="Open photo" loading="lazy" />
                </button>
              </li>
            </ul>
          </li>
        </ol>
      </section>

      <section v-if="canEdit && !sightings.length" class="remove">
        <button class="btn danger" type="button" @click="removeFromDex">Remove species from catalogue</button>
      </section>
    </template>

    <div v-if="lightbox" class="lightbox" role="dialog" aria-modal="true" aria-label="Photo" @click.self="lightbox = null">
      <figure>
        <img :src="lightbox.urls.display" :alt="entry?.commonName" />
        <figcaption>
          <span>
            {{ lightbox.takenAt ? formatDate(lightbox.takenAt, true) : '' }}
            <span class="soft">{{ exifLine(lightbox) }}</span>
          </span>
          <span class="row">
            <a v-if="lightbox.urls.original" :href="lightbox.urls.original" target="_blank" rel="noopener" class="btn quiet">
              Original
            </a>
            <button v-if="canEdit" class="btn quiet" type="button" @click="setCover(lightbox)">Use as cover</button>
            <button v-if="canEdit" class="btn quiet danger-text" type="button" @click="deletePhoto(lightbox)">Delete</button>
            <button ref="closeBtn" class="btn" type="button" @click="lightbox = null">Close</button>
          </span>
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 28px;
  margin-bottom: 36px;
}
.hero-photo {
  aspect-ratio: 4 / 3;
  border-radius: var(--radius);
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--paper-raised);
}
.hero-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hero-photo.missing {
  border: 1.5px dashed var(--rule);
  background: transparent;
}
.hero-photo.logged {
  border: 1.5px dashed var(--goldfinch);
  background: var(--goldfinch-wash);
}
.no {
  font-family: var(--font-display);
  color: var(--jay);
  font-weight: 600;
  margin: 0;
}
.common {
  font-size: var(--step-4);
  margin: 0;
}
.hero-text > .sci {
  font-size: var(--step-1);
  color: var(--ink-soft);
}
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  margin: 0 0 20px;
}
.facts dt {
  color: var(--ink-soft);
}
.facts dd {
  margin: 0;
}
.notes {
  margin-bottom: 36px;
}
.notes textarea {
  margin-bottom: 10px;
}
.pre {
  white-space: pre-wrap;
}
.sightings {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sighting {
  border-top: 1px solid var(--rule);
  padding: 14px 0;
}
.s-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  align-items: baseline;
}
.s-head .row {
  gap: 4px;
}
.s-head label.btn {
  cursor: pointer;
}
.danger-text {
  color: var(--danger);
}
.strip {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.thumb {
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
  border-radius: var(--radius);
  overflow: hidden;
  display: block;
}
.thumb img {
  width: 120px;
  height: 120px;
  object-fit: cover;
  display: block;
}
.remove {
  margin-top: 36px;
}
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(10 14 12 / 0.88);
  display: grid;
  place-items: center;
  padding: 16px;
}
.lightbox figure {
  margin: 0;
  max-width: min(1400px, 100%);
  display: grid;
  gap: 10px;
}
.lightbox img {
  max-width: 100%;
  max-height: calc(100vh - 120px);
  object-fit: contain;
  margin: 0 auto;
  display: block;
}
.lightbox figcaption {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  color: #e2e8e3;
}
.lightbox .soft {
  color: #aab5ae;
  margin-left: 8px;
}
.lightbox .btn.quiet {
  color: #8cc0dc;
}
.lightbox .danger-text {
  color: #e07a6c;
}
@media (max-width: 760px) {
  .hero {
    grid-template-columns: 1fr;
  }
}
</style>
