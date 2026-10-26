<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import { describeDuplicate, markDuplicates } from '../duplicates.js';
import { readPhotoMetadata } from '../exif.js';
import { formatDate, fromLocalInput } from '../format.js';
import { session } from '../session.js';

/**
 * Bulk upload: drop a whole shoot's photos, give each one a species (typed, or picked from AI
 * suggestions), and save. Photos of the same species taken close together become one sighting.
 */
const { catalogue, species, reload, reloadDex } = useCatalogue();
const router = useRouter();

const ACCEPT = 'image/jpeg,image/heic,image/heif,.heic,.heif,image/png,image/webp,image/tiff,image/avif';
const items = ref([]); // see addFiles()
const group = ref(true);
const GROUP_MINUTES = 30;
const saving = ref(false);
const done = ref(null); // { sightings, photos, failed }
const error = ref('');
const dragging = ref(false);
let nextId = 1;

const byName = computed(() => new Map(species.value.map((s) => [s.commonName.toLowerCase(), s])));
const isHeic = (f) => /\.hei[cf]$/i.test(f.name) || /hei[cf]/.test(f.type);

async function addFiles(fileList) {
  error.value = '';
  done.value = null;
  const maxBytes = session.config.maxUploadMb > 0 ? session.config.maxUploadMb * 1024 * 1024 : Infinity;
  const picked = [...fileList].filter((f) => /^image\//.test(f.type) || isHeic(f));
  const tooBig = picked.filter((f) => f.size > maxBytes);
  if (tooBig.length) error.value = `${tooBig.length} photo${tooBig.length === 1 ? ' is' : 's are'} over ${session.config.maxUploadMb} MB and ${tooBig.length === 1 ? 'was' : 'were'} skipped.`;
  const added = picked
    .filter((f) => f.size <= maxBytes)
    .map((file) =>
      reactive({
        id: nextId++,
        file,
        url: URL.createObjectURL(file),
        noPreview: false,
        meta: null, // { localDateTime, latitude, longitude, camera }
        duplicates: null,
        speciesText: '',
        speciesId: null,
        ai: null, // { state: 'running' | 'done' | 'error', suggestions, decision, error }
        skip: false,
        status: 'ready', // ready | saving | saved | error
        error: '',
      }),
    );
  items.value.push(...added);
  // Read each photo's date and place (four at a time), and check for photos already uploaded.
  const queue = [...added];
  await Promise.all([
    ...Array.from({ length: 4 }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        let meta = await readPhotoMetadata(item.file);
        if (isHeic(item.file) && !meta.localDateTime && meta.latitude === null) {
          try {
            meta = { ...meta, ...(await api.upload('/photo-info', item.file)) };
          } catch {
            /* the server fills these in on save */
          }
        }
        item.meta = meta;
      }
    }),
    markDuplicates(catalogue.value.slug, added).then(() => added.forEach((i) => i.duplicates && (i.skip = true))),
  ]);
  items.value.sort((a, b) => (a.meta?.localDateTime || '9').localeCompare(b.meta?.localDateTime || '9'));
}

function onPick(e) {
  addFiles(e.target.files ?? []);
  e.target.value = '';
}
function onDrop(e) {
  dragging.value = false;
  addFiles(e.dataTransfer?.files ?? []);
}
function remove(item) {
  URL.revokeObjectURL(item.url);
  items.value = items.value.filter((i) => i !== item);
}
onUnmounted(() => items.value.forEach((i) => URL.revokeObjectURL(i.url)));

function onSpeciesInput(item) {
  const match = byName.value.get(item.speciesText.trim().toLowerCase());
  item.speciesId = match?.id ?? null;
}
function speciesName(id) {
  return species.value.find((s) => s.id === id)?.commonName ?? '';
}
/** Use the same species for every following photo that doesn't have one yet. */
function fillDown(item) {
  const i = items.value.indexOf(item);
  for (const next of items.value.slice(i + 1)) {
    if (next.speciesId || next.skip) break;
    next.speciesId = item.speciesId;
    next.speciesText = item.speciesText;
  }
}

// ---- AI suggestions --------------------------------------------------------------------
const aiRunning = ref(false);
async function suggest(item) {
  item.ai = { state: 'running', suggestions: [], decision: null, error: '' };
  try {
    const fields = item.meta?.latitude != null ? { latitude: String(item.meta.latitude), longitude: String(item.meta.longitude) } : {};
    const res = await api.upload(`/catalogues/${catalogue.value.slug}/identify`, item.file, fields);
    if (res.preview && item.noPreview) item.url = res.preview;
    item.ai = { state: 'done', suggestions: res.suggestions.slice(0, 3), model: res.model, all: res.suggestions.slice(0, 6), error: '' };
  } catch (err) {
    item.ai = { state: 'error', suggestions: [], error: err.message };
  }
}
async function suggestAll() {
  aiRunning.value = true;
  for (const item of items.value) {
    if (item.speciesId || item.skip || item.ai?.state === 'done') continue;
    await suggest(item);
  }
  aiRunning.value = false;
}
const keyOf = (s) => s.ebirdCode ?? s.scientificName;
async function acceptSuggestion(item, s) {
  try {
    let id = s.speciesId;
    if (!s.inCatalogue) {
      const body = s.ebirdCode ? { ebirdCode: s.ebirdCode } : s.speciesId ? { speciesId: s.speciesId } : { commonName: s.commonName, scientificName: s.scientificName };
      id = (await api.post(`/catalogues/${catalogue.value.slug}/species`, body)).entry.id;
      s.inCatalogue = true;
      s.speciesId = id;
      await reloadDex();
    }
    item.speciesId = id;
    item.speciesText = speciesName(id) || s.commonName;
    item.ai.decision = {
      model: item.ai.model,
      suggestions: item.ai.all.map((x) => ({ ebirdCode: x.ebirdCode, scientificName: x.scientificName, commonName: x.commonName, confidence: x.confidence })),
      accepted: keyOf(s),
      rejected: [],
    };
  } catch (err) {
    item.ai.error = err.message;
  }
}

// ---- Saving --------------------------------------------------------------------------------
const toSave = computed(() => items.value.filter((i) => !i.skip && i.status !== 'saved'));
const ready = computed(() => toSave.value.filter((i) => i.speciesId));
const needSpecies = computed(() => toSave.value.filter((i) => !i.speciesId).length);
const savedCount = computed(() => items.value.filter((i) => i.status === 'saved').length);

/** Photos in shooting order, grouped into sightings: same species, within 30 minutes of the last. */
const groups = computed(() => {
  const list = [...ready.value].sort((a, b) => (a.meta?.localDateTime || '').localeCompare(b.meta?.localDateTime || ''));
  const out = [];
  for (const item of list) {
    const last = out.at(-1);
    const t = Date.parse(item.meta?.localDateTime || '');
    const lastT = last ? Date.parse(last.at(-1).meta?.localDateTime || '') : NaN;
    const close = Number.isFinite(t) && Number.isFinite(lastT) && t - lastT <= GROUP_MINUTES * 60 * 1000;
    if (group.value && last && last[0].speciesId === item.speciesId && close) last.push(item);
    else out.push([item]);
  }
  return out;
});

async function placeName(lat, lng) {
  try {
    return (await api.get(`/places/reverse?latitude=${lat}&longitude=${lng}`)).suggestion?.name ?? '';
  } catch {
    return '';
  }
}

async function saveAll() {
  saving.value = true;
  error.value = '';
  let sightings = 0;
  let photos = 0;
  for (const g of groups.value) {
    const first = g[0];
    const located = g.find((i) => i.meta?.latitude != null);
    g.forEach((i) => (i.status = 'saving'));
    try {
      const { sighting } = await api.post(`/catalogues/${catalogue.value.slug}/sightings`, {
        speciesId: first.speciesId,
        observedAt: fromLocalInput(first.meta?.localDateTime) ?? null,
        latitude: located ? located.meta.latitude : null,
        longitude: located ? located.meta.longitude : null,
        locationName: located ? await placeName(located.meta.latitude, located.meta.longitude) : '',
        notes: '',
      });
      let uploaded = 0;
      for (const item of g) {
        try {
          const fields = item.ai?.decision ? { ai: JSON.stringify(item.ai.decision) } : {};
          await api.upload(`/sightings/${sighting.id}/photos`, item.file, fields);
          item.status = 'saved';
          uploaded += 1;
          photos += 1;
        } catch (err) {
          item.status = 'error';
          item.error = err.message;
        }
      }
      // Every sighting needs a photo: undo one whose photos all failed.
      if (!uploaded) await api.del(`/sightings/${sighting.id}`).catch(() => {});
      else sightings += 1;
    } catch (err) {
      g.forEach((i) => {
        i.status = 'error';
        i.error = err.message;
      });
    }
  }
  saving.value = false;
  done.value = { sightings, photos, failed: items.value.filter((i) => i.status === 'error').length };
  await Promise.all([reload(), reloadDex()]);
}

function finish() {
  router.push({ name: 'recent', params: { slug: catalogue.value.slug } });
}
</script>

<template>
  <p v-if="!catalogue.access.canEdit" class="notice">Only the owner and editors can log sightings in this catalogue.</p>
  <div v-else class="bulk">
    <div class="head">
      <h2>Bulk upload</h2>
      <RouterLink :to="{ name: 'log', params: { slug: catalogue.slug } }" class="small">Log a single sighting instead</RouterLink>
    </div>
    <p class="soft">
      Add a whole shoot’s photos. Give each one a species (type it, or ask for AI suggestions), then save: each photo
      becomes a sighting, with its date and place read from the photo.
    </p>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <label
      class="drop"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <strong>{{ items.length ? 'Add more photos' : 'Choose photos' }}</strong>
      <span class="soft small">or drop them here. JPEG, HEIC, PNG, WebP, TIFF or AVIF.</span>
      <input class="visually-hidden" type="file" :accept="ACCEPT" multiple @change="onPick" />
    </label>

    <template v-if="items.length">
      <div class="toolbar">
        <label class="check">
          <input v-model="group" type="checkbox" />
          Combine photos of the same species taken within {{ GROUP_MINUTES }} minutes into one sighting
        </label>
        <button
          v-if="session.config.identifyEnabled"
          class="btn"
          type="button"
          :disabled="aiRunning || saving"
          @click="suggestAll"
        >
          {{ aiRunning ? 'Suggesting...' : 'Suggest species with AI' }}
        </button>
      </div>

      <datalist id="bulk-species">
        <option v-for="s in species" :key="s.id" :value="s.commonName" />
      </datalist>

      <ol class="items">
        <li v-for="item in items" :key="item.id" :class="['item', item.status, { skip: item.skip }]">
          <div class="pic">
            <img v-if="!item.noPreview" :src="item.url" :alt="item.file.name" loading="lazy" @error="item.noPreview = true" />
            <span v-else class="no-preview small"><strong>HEIC photo</strong>{{ item.file.name }}</span>
          </div>
          <div class="body">
            <p class="small meta">
              <strong>{{ item.meta?.localDateTime ? formatDate(fromLocalInput(item.meta.localDateTime), true) : item.meta ? 'No date in photo' : 'Reading...' }}</strong>
              <span v-if="item.meta && item.meta.latitude == null" class="soft"> · no location</span>
              <span class="soft name"> · {{ item.file.name }}</span>
            </p>
            <p v-if="item.duplicates" class="dup small" role="note">
              Already uploaded: {{ describeDuplicate(item.duplicates) }}. Skipped unless you include it.
            </p>

            <template v-if="item.status === 'saved'">
              <p class="saved small">Saved as {{ speciesName(item.speciesId) }}</p>
            </template>
            <template v-else>
              <div class="row species-row">
                <label class="field species">
                  <span class="visually-hidden">Species for {{ item.file.name }}</span>
                  <input
                    v-model="item.speciesText"
                    list="bulk-species"
                    type="text"
                    placeholder="Species"
                    :disabled="item.skip || saving"
                    :aria-invalid="item.speciesText && !item.speciesId ? 'true' : undefined"
                    @input="onSpeciesInput(item)"
                    @change="onSpeciesInput(item)"
                  />
                </label>
                <button
                  v-if="item.speciesId"
                  class="btn quiet small-text"
                  type="button"
                  :disabled="saving"
                  title="Use this species for the photos after this one that don't have one yet"
                  @click="fillDown(item)"
                >
                  Same for next
                </button>
                <button
                  v-if="session.config.identifyEnabled && !item.speciesId && !item.skip && item.ai?.state !== 'running'"
                  class="btn quiet small-text"
                  type="button"
                  :disabled="saving"
                  @click="suggest(item)"
                >
                  Suggest
                </button>
                <label class="check small">
                  <input v-model="item.skip" type="checkbox" :disabled="saving" />
                  Skip
                </label>
                <button class="btn quiet small-text" type="button" :disabled="saving" @click="remove(item)">Remove</button>
              </div>
              <p v-if="item.speciesText && !item.speciesId && !item.skip" class="hint small">
                Not in this catalogue. Pick a name from the list, or add the species in Settings first.
              </p>
              <div v-if="item.ai?.state === 'running'" class="soft small">Asking the AI...</div>
              <div v-else-if="item.ai?.state === 'done' && !item.speciesId" class="chips">
                <button v-for="s in item.ai.suggestions" :key="keyOf(s)" type="button" class="chip" @click="acceptSuggestion(item, s)">
                  {{ s.commonName }} <span class="pct">{{ Math.round(s.confidence * 100) }}%</span>
                  <span v-if="!s.inCatalogue" class="add">+ add</span>
                </button>
              </div>
              <p v-if="item.ai?.error" class="small error-text">{{ item.ai.error }}</p>
              <p v-if="item.status === 'error'" class="small error-text">Not saved: {{ item.error }}</p>
            </template>
          </div>
        </li>
      </ol>

      <div class="savebar">
        <p v-if="done" class="small" role="status">
          <strong>Saved {{ done.sightings }} sighting{{ done.sightings === 1 ? '' : 's' }} with {{ done.photos }} photo{{ done.photos === 1 ? '' : 's' }}.</strong>
          <template v-if="done.failed"> {{ done.failed }} didn’t save; fix them and save again.</template>
        </p>
        <p v-else class="small soft">
          {{ ready.length }} photo{{ ready.length === 1 ? '' : 's' }} ready as {{ groups.length }} sighting{{ groups.length === 1 ? '' : 's' }}<template v-if="needSpecies">
            · {{ needSpecies }} still need a species</template
          ><template v-if="savedCount"> · {{ savedCount }} saved</template>
        </p>
        <div class="row">
          <button class="btn primary" type="button" :disabled="saving || !ready.length" @click="saveAll">
            {{ saving ? 'Saving...' : `Save ${ready.length} photo${ready.length === 1 ? '' : 's'}` }}
          </button>
          <button v-if="done" class="btn" type="button" @click="finish">See recent sightings</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px 16px;
  flex-wrap: wrap;
}
.drop {
  display: grid;
  place-items: center;
  gap: 4px;
  padding: 28px 16px;
  margin: 12px 0 16px;
  border: 2px dashed var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  text-align: center;
  cursor: pointer;
}
.drop:hover,
.drop.dragging,
.drop:focus-within {
  border-color: var(--jay);
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.check {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}
.item {
  display: grid;
  grid-template-columns: 112px 1fr;
  gap: 14px;
  padding: 10px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
}
.item.skip {
  opacity: 0.55;
}
.item.saved {
  border-color: var(--jay);
}
.item.error {
  border-color: var(--danger);
}
.pic {
  width: 112px;
  height: 112px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--paper);
}
.pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.no-preview {
  display: grid;
  align-content: center;
  height: 100%;
  padding: 8px;
  text-align: center;
  overflow-wrap: anywhere;
}
.body {
  min-width: 0;
  display: grid;
  gap: 6px;
  align-content: start;
}
.meta {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dup {
  margin: 0;
  padding: 2px 8px;
  border-radius: var(--radius);
  background: var(--goldfinch-wash);
}
.species-row {
  gap: 6px 10px;
}
.species {
  flex: 1 1 220px;
  margin: 0;
}
.small-text {
  font-size: var(--step--1);
}
.hint {
  margin: 0;
  color: var(--ink-soft);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font: inherit;
  font-size: var(--step--1);
  font-weight: 700;
  padding: 4px 10px;
  min-height: 34px;
  border-radius: 999px;
  border: 1px solid var(--jay);
  background: var(--jay-wash);
  color: var(--ink);
  cursor: pointer;
}
.chip .pct {
  font-weight: 400;
  color: var(--ink-soft);
}
.chip .add {
  font-weight: 400;
  color: var(--jay);
}
.saved {
  margin: 0;
  color: var(--jay);
  font-weight: 700;
}
.error-text {
  margin: 0;
  color: var(--danger);
}
/* The save bar stays in reach at the bottom while scrolling through the photos. */
.savebar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  margin-top: 16px;
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px 16px;
  flex-wrap: wrap;
  background: var(--paper);
  border-top: 1px solid var(--rule);
}
.savebar p {
  margin: 0;
}
@media (max-width: 640px) {
  .item {
    grid-template-columns: 80px 1fr;
    gap: 10px;
  }
  .pic {
    width: 80px;
    height: 80px;
  }
  .savebar {
    bottom: calc(64px + env(safe-area-inset-bottom));
  }
}
</style>
