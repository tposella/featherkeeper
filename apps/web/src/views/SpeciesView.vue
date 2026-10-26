<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { session } from '../session.js';
import { useCatalogue } from '../catalogue-context.js';
import SpeciesInsights from '../components/SpeciesInsights.vue';
import SpeciesSounds from '../components/SpeciesSounds.vue';
import EditSighting from '../components/EditSighting.vue';
import ThumbnailPicker from '../components/ThumbnailPicker.vue';
import { formatDate, plateNumber } from '../format.js';

const props = defineProps({ speciesId: { type: Number, required: true } });
const { catalogue, species, reload, reloadDex, dexStyle } = useCatalogue();
const router = useRouter();
const route = useRoute();

const entry = ref(null);
const sightings = ref([]);
const error = ref('');
const notes = ref('');
const editingNotes = ref(false);
const lightbox = ref(null);
const uploadingFor = ref(null);

const canEdit = computed(() => catalogue.value.access.canEdit);
const plate = computed(() => species.value.findIndex((s) => s.id === props.speciesId) + 1);
// The album: every photo of this species across all sightings, newest first.
const allPhotos = computed(() => {
  const when = (p) => Date.parse(p.takenAt ?? p.createdAt) || 0;
  return sightings.value
    .flatMap((s) => s.photos.map((p) => ({ ...p, place: s.locationName || '' })))
    .sort((a, b) => when(b) - when(a));
});
const cover = computed(() => allPhotos.value.find((p) => p.id === entry.value?.coverPhotoId) ?? null);
const picking = ref(false);
const editing = ref(null); // the sighting being edited
const moved = ref(null); // { speciesId, commonName } after moving a sighting to another species

async function onSightingSaved(updated) {
  const was = editing.value;
  editing.value = null;
  if (updated.speciesId !== was.speciesId) {
    const to = species.value.find((x) => x.id === updated.speciesId);
    moved.value = { speciesId: updated.speciesId, commonName: to?.commonName ?? 'another species' };
  }
  await refreshAll();
}
const savingCover = ref(false);
const showAllAlbum = ref(false);
const ALBUM_PREVIEW = 12;
const albumShown = computed(() => (showAllAlbum.value ? allPhotos.value : allPhotos.value.slice(0, ALBUM_PREVIEW)));
const lightboxIndex = computed(() => allPhotos.value.findIndex((p) => p.id === lightbox.value?.id));
function step(d) {
  const n = allPhotos.value.length;
  if (n < 2 || lightboxIndex.value < 0) return;
  lightbox.value = allPhotos.value[(lightboxIndex.value + d + n) % n];
}

async function load() {
  try {
    const examples = dexStyle.value === 'examples' ? '?examples=1' : '';
    const res = await api.get(`/catalogues/${catalogue.value.slug}/species/${props.speciesId}${examples}`);
    entry.value = res.entry;
    sightings.value = res.sightings;
    notes.value = res.entry.notes;
    // Links from the "To replace" tab open the photo straight away.
    const wanted = Number(route.query.photo);
    if (wanted && !lightbox.value) lightbox.value = allPhotos.value.find((p) => p.id === wanted) ?? null;
  } catch (err) {
    error.value = err.status === 404 ? 'That species is not in this catalogue.' : err.message;
  }
}
onMounted(load);

// Lightbox: focus the close button on open, close on Escape, return focus afterwards.
const closeBtn = ref(null);
let lastFocus = null;
watch(lightbox, async (open, wasOpen) => {
  if (open?.id !== wasOpen?.id) replaceForm.value = null;
  if (open && !wasOpen) {
    lastFocus = document.activeElement;
    await nextTick();
    closeBtn.value?.focus();
  } else if (!open && wasOpen) {
    lastFocus?.focus?.();
  }
});
// Swipe left or right on the photo to move between photos (touch screens).
let touch = null;
function onTouchStart(e) {
  if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function onTouchEnd(e) {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
}
function onKey(e) {
  if (!lightbox.value) return;
  if (e.target.closest?.('input, textarea')) return; // typing a note

  if (e.key === 'Escape') lightbox.value = null;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
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

/** Pick the photo that represents this species; null goes back to "newest photo". */
async function setCover(photoId) {
  savingCover.value = true;
  try {
    const res = await api.patch(`/catalogues/${catalogue.value.slug}/species/${props.speciesId}`, { coverPhotoId: photoId });
    entry.value = { ...entry.value, ...res.entry };
    picking.value = false;
    await Promise.all([reloadDex(), reload()]);
  } catch (err) {
    error.value = err.message;
  } finally {
    savingCover.value = false;
  }
}

// "Want to replace": a subpar photo kept until a better one comes along.
const replaceForm = ref(null); // { note } while marking or editing the note
const savingReplace = ref(false);
const replaceInput = ref(null);
async function startReplace(p) {
  replaceForm.value = { note: p.replace?.note ?? '' };
  await nextTick();
  replaceInput.value?.focus();
}
async function saveReplace(p, replace) {
  savingReplace.value = true;
  error.value = '';
  try {
    const body = replace ? { replace: true, replaceNote: replaceForm.value?.note?.trim() ?? p.replace?.note ?? '' } : { replace: false };
    const res = await api.patch(`/photos/${p.id}`, body);
    for (const s of sightings.value) {
      const hit = s.photos.find((x) => x.id === p.id);
      if (hit) hit.replace = res.photo.replace;
    }
    if (lightbox.value?.id === p.id) lightbox.value = { ...lightbox.value, replace: res.photo.replace };
    replaceForm.value = null;
    await reload(); // the tab's count
  } catch (err) {
    error.value = err.message;
  } finally {
    savingReplace.value = false;
  }
}

async function deletePhoto(photo) {
  // Every sighting has a photo, so removing a sighting's only photo removes the sighting too.
  const only = sightings.value.find((s) => s.id === photo.sightingId)?.photos.length === 1;
  const msg = only
    ? 'This is the only photo of this sighting, so the sighting will be deleted too. This cannot be undone.'
    : 'Delete this photo? This cannot be undone.';
  if (!confirm(msg)) return;
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
    <div v-if="moved" class="notice" role="status">
      Sighting moved to
      <RouterLink :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: moved.speciesId } }">
        {{ moved.commonName }}</RouterLink
      >.
      <button class="btn quiet small" type="button" @click="moved = null">Dismiss</button>
    </div>

    <template v-if="entry">
      <section class="hero">
        <div class="hero-photo" :class="entry.status">
          <button v-if="cover" type="button" class="hero-open" :aria-label="`Open the thumbnail photo of ${entry.commonName}`" @click="lightbox = cover">
            <img :src="cover.urls.display" alt="" />
          </button>
          <img v-else-if="entry.coverUrl" :src="entry.coverUrl" alt="" />
          <template v-else-if="dexStyle === 'examples' && entry.example">
            <img :src="entry.example.url" class="example-img" :alt="`Example photo of a ${entry.commonName}`" />
            <p class="example-note small">
              <strong>Not yet photographed.</strong>
              Example photo:
              <a v-if="entry.example.page" :href="entry.example.page" target="_blank" rel="noopener">{{
                entry.example.credit || entry.example.source
              }}</a
              ><template v-else>{{ entry.example.credit || entry.example.source }}</template
              ><template v-if="entry.example.licence && !entry.example.credit.includes(entry.example.licence)">,
                {{ entry.example.licence }}</template
              >
            </p>
          </template>
          <span v-else class="soft">Not yet photographed</span>
          <button v-if="canEdit && allPhotos.length > 1" type="button" class="change-thumb" @click="picking = true">
            Change thumbnail
          </button>
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

      <section v-if="allPhotos.length" class="album">
        <div class="album-head">
          <h3>Album <span class="n">{{ allPhotos.length }} photo{{ allPhotos.length === 1 ? '' : 's' }}</span></h3>
          <button v-if="canEdit && allPhotos.length > 1" class="btn" type="button" @click="picking = true">
            Change thumbnail
          </button>
        </div>
        <ul class="album-grid">
          <li v-for="p in albumShown" :key="p.id">
            <button type="button" class="album-tile" @click="lightbox = p">
              <img :src="p.urls.thumb" :alt="`${entry.commonName}, ${formatDate(p.takenAt || p.createdAt)}`" loading="lazy" />
              <span v-if="p.id === entry.coverPhotoId" class="badge small">Thumbnail</span>
              <span v-if="p.replace" class="flag small" :title="p.replace.note || 'Marked to replace'">To replace</span>
              <span class="cap small">
                {{ formatDate(p.takenAt || p.createdAt) }}<template v-if="p.place"> · {{ p.place }}</template>
              </span>
            </button>
          </li>
        </ul>
        <button v-if="!showAllAlbum && allPhotos.length > ALBUM_PREVIEW" class="btn quiet" type="button" @click="showAllAlbum = true">
          Show all {{ allPhotos.length }} photos
        </button>
      </section>

      <SpeciesSounds
        v-if="session.config.soundsEnabled !== false"
        :catalogue="catalogue.slug"
        :species-id="entry.id"
        :common-name="entry.commonName"
      />

      <SpeciesInsights :catalogue="catalogue.slug" :species-id="entry.id" :common-name="entry.commonName" />

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
                    accept="image/jpeg,image/heic,image/heif,.heic,.heif,image/png,image/webp,image/tiff,image/avif"
                    multiple
                    :disabled="uploadingFor === s.id"
                    @change="addPhotos(s, $event)"
                  />
                </label>
                <button class="btn quiet" type="button" @click="editing = s">Edit</button>
                <button class="btn quiet danger-text" type="button" @click="deleteSighting(s)">Delete</button>
              </div>
            </div>
            <p v-if="s.notes" class="pre">{{ s.notes }}</p>
            <ul v-if="s.photos.length" class="strip">
              <li v-for="p in s.photos" :key="p.id">
                <button type="button" class="thumb" @click="lightbox = p">
                  <img :src="p.urls.thumb" :alt="p.replace ? 'Open photo (marked to replace)' : 'Open photo'" loading="lazy" />
                  <span v-if="p.replace" class="mini-flag" aria-hidden="true">To replace</span>
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
        <div class="stage" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
          <button v-if="allPhotos.length > 1" class="nav prev" type="button" aria-label="Previous photo" @click="step(-1)">&lsaquo;</button>
          <img :src="lightbox.urls.display" :alt="entry?.commonName" />
          <button v-if="allPhotos.length > 1" class="nav next" type="button" aria-label="Next photo" @click="step(1)">&rsaquo;</button>
        </div>
        <figcaption>
          <span>
            <span v-if="allPhotos.length > 1 && lightboxIndex >= 0" class="count">{{ lightboxIndex + 1 }} of {{ allPhotos.length }}</span>
            {{ lightbox.takenAt ? formatDate(lightbox.takenAt, true) : '' }}
            <span class="soft">{{ exifLine(lightbox) }}</span>
          </span>
          <span class="row">
            <a v-if="lightbox.urls.original" :href="lightbox.urls.original" target="_blank" rel="noopener" class="btn quiet">
              Original
            </a>
            <span v-if="lightbox.id === entry?.coverPhotoId" class="is-thumb">Thumbnail</span>
            <button v-else-if="canEdit" class="btn quiet" type="button" :disabled="savingCover" @click="setCover(lightbox.id)">
              Use as thumbnail
            </button>
            <button v-if="canEdit" class="btn quiet danger-text" type="button" @click="deletePhoto(lightbox)">Delete</button>
            <button ref="closeBtn" class="btn" type="button" @click="lightbox = null">Close</button>
          </span>
        </figcaption>
        <div v-if="canEdit" class="replace-bar" :class="{ marked: lightbox.replace }">
          <form v-if="replaceForm" class="replace-form" @submit.prevent="saveReplace(lightbox, true)">
            <label for="replace-note">What would make a better shot? <span class="soft">(optional)</span></label>
            <div class="row">
              <input
                id="replace-note"
                v-model="replaceForm.note"
                type="text"
                maxlength="1000"
                placeholder="e.g. soft focus, backlit, only the tail"
                ref="replaceInput"
                @keydown.esc.stop.prevent="replaceForm = null"
              />
              <button class="btn primary" type="submit" :disabled="savingReplace">
                {{ lightbox.replace ? 'Save note' : 'Mark to replace' }}
              </button>
              <button class="btn quiet" type="button" @click="replaceForm = null">Cancel</button>
            </div>
          </form>
          <template v-else-if="lightbox.replace">
            <span class="replace-text">
              <strong>Marked to replace</strong><template v-if="lightbox.replace.note">: {{ lightbox.replace.note }}</template>
              <span v-if="lightbox.replace.markedAt" class="soft small"> · since {{ formatDate(lightbox.replace.markedAt) }}</span>
            </span>
            <span class="row">
              <button class="btn quiet" type="button" @click="startReplace(lightbox)">Edit note</button>
              <button class="btn quiet" type="button" :disabled="savingReplace" @click="saveReplace(lightbox, false)">Unmark</button>
            </span>
          </template>
          <template v-else>
            <span class="soft small">Not happy with this one? Mark it and it’ll show on the To replace tab.</span>
            <button class="btn quiet" type="button" @click="startReplace(lightbox)">Want to replace</button>
          </template>
        </div>
      </figure>
    </div>

    <EditSighting
      v-if="editing"
      :sighting="editing"
      :catalogue="catalogue"
      :species="species"
      @saved="onSightingSaved"
      @close="editing = null"
    />

    <ThumbnailPicker
      v-if="picking && entry"
      :photos="allPhotos"
      :current-id="entry.coverPhotoId"
      :chosen="entry.coverChosen"
      :common-name="entry.commonName"
      :saving="savingCover"
      @choose="setCover"
      @close="picking = false"
    />
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
.hero-photo {
  position: relative;
}
.hero-open {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.change-thumb {
  position: absolute;
  right: 10px;
  bottom: 10px;
  font: inherit;
  font-size: var(--step--1);
  font-weight: 700;
  color: #fff;
  background: rgb(20 28 24 / 0.72);
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  backdrop-filter: blur(4px);
}
.change-thumb:hover {
  background: rgb(20 28 24 / 0.88);
}
.album {
  margin-bottom: 36px;
}
.album-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.album-head .n {
  font-weight: 400;
  color: var(--ink-soft);
  font-size: var(--step-0);
  margin-left: 6px;
}
.album-grid {
  list-style: none;
  padding: 0;
  margin: 8px 0 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.album-tile {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--paper-raised);
  cursor: zoom-in;
  font: inherit;
  text-align: left;
}
.album-tile img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.album-tile .cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 8px 6px;
  color: #fff;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.album-tile .badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: var(--jay);
  color: #fff;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 9px;
}
.album-tile .flag {
  position: absolute;
  top: 6px;
  right: 6px;
  background: var(--goldfinch);
  color: #1d1a0f;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 9px;
}
.album-tile:focus-visible,
.album-tile:hover {
  outline: 2px solid var(--jay);
  outline-offset: 2px;
}
.stage {
  position: relative;
}
.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 0.3);
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  font-size: 1.8rem;
  line-height: 1;
  cursor: pointer;
}
.nav.prev {
  left: 8px;
}
.nav.next {
  right: 8px;
}
.count {
  font-weight: 700;
  margin-right: 8px;
}
.is-thumb {
  font-weight: 700;
  color: #8cc0dc;
  padding: 0 8px;
}
.hero-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.example-note {
  position: absolute;
  justify-self: stretch; /* the frame is a centring grid */
  align-self: end;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: 8px 12px;
  background: rgb(20 28 24 / 0.72);
  color: #e8ece9;
}
.example-note a {
  color: #bcdcee;
}
.hero-photo.missing {
  border: 1.5px dashed var(--rule);
  background: transparent;
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
.thumb {
  position: relative;
}
.mini-flag {
  position: absolute;
  left: 4px;
  bottom: 4px;
  background: var(--goldfinch);
  color: #1d1a0f;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 999px;
  padding: 0 7px;
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
  max-height: calc(100vh - 180px);
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
.replace-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;
  color: #e2e8e3;
  border-top: 1px solid rgb(255 255 255 / 0.15);
  padding-top: 8px;
}
.replace-bar .soft {
  margin-left: 0;
}
.replace-bar.marked .replace-text strong {
  color: #f0c64a;
}
.replace-form {
  display: grid;
  gap: 6px;
  width: 100%;
}
.replace-form .row {
  flex-wrap: wrap;
}
.replace-form input {
  flex: 1 1 260px;
  min-width: 0;
}
.lightbox .danger-text {
  color: #e07a6c;
}
@media (max-width: 760px) {
  .hero {
    grid-template-columns: 1fr;
  }
}
/* Phones: the photo viewer fills the screen, the photo gets as much room as possible, and the
   buttons sit underneath in finger-sized rows. */
@media (max-width: 640px) {
  .lightbox {
    padding: 0;
    background: #0a0e0c;
    place-items: stretch;
    overflow-y: auto;
  }
  .lightbox figure {
    min-height: 100%;
    grid-template-rows: 1fr auto auto;
    gap: 0;
    padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  }
  .stage {
    display: grid;
    place-items: center;
    touch-action: pan-y;
  }
  .lightbox img {
    max-height: 68vh;
    width: 100%;
  }
  .nav {
    width: 38px;
    height: 38px;
    font-size: 1.5rem;
  }
  .lightbox figcaption {
    display: grid;
    gap: 8px;
    padding: 10px 14px;
  }
  .lightbox figcaption > .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 6px;
  }
  .lightbox figcaption .btn {
    justify-content: center;
  }
  .lightbox .soft {
    display: block;
    margin: 2px 0 0;
  }
  .replace-bar {
    padding: 10px 14px 14px;
  }
  .album-head {
    flex-wrap: wrap;
  }
}
@media (max-width: 640px) {
  .album-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .album-tile .badge,
  .album-tile .flag {
    font-size: 0.7rem;
    padding: 0 7px;
  }
  .thumb img {
    width: 96px;
    height: 96px;
  }
  .s-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
