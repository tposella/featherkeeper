<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';
import PhotoCompare from './PhotoCompare.vue';

/**
 * Asks the server which species a photo shows, weighted by where it was taken,
 * and lets the user accept one of the top matches or reject them.
 * Emits `accepted` with the dex species id, and `decision` with what to store alongside the photo.
 */
const props = defineProps({
  catalogue: { type: String, required: true },
  file: { type: Object, required: true },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  selectedSpeciesId: { type: Number, default: null },
  auto: { type: Boolean, default: true },
});
const emit = defineEmits(['accepted', 'decision', 'none']);

const result = ref(null);
const loading = ref(false);
const error = ref('');
const rejected = ref(new Set());
const acceptedKey = ref(null);
const busyKey = ref(null);
const showMore = ref(false);

const keyOf = (s) => s.ebirdCode ?? s.scientificName;
const visible = computed(() => {
  const list = (result.value?.suggestions ?? []).filter((s) => !rejected.value.has(keyOf(s)));
  return showMore.value ? list.slice(0, 6) : list.slice(0, 3);
});
const hiddenCount = computed(() => {
  const list = (result.value?.suggestions ?? []).filter((s) => !rejected.value.has(keyOf(s)));
  return Math.max(0, Math.min(6, list.length) - visible.value.length);
});

// Reference photos per suggestion, loaded as cards appear. Shared across runs.
const references = reactive({});
const compare = ref(null); // { s, start }
const yourPhoto = ref('');
watch(
  () => props.file,
  (file, old) => {
    if (yourPhoto.value) URL.revokeObjectURL(yourPhoto.value);
    yourPhoto.value = file ? URL.createObjectURL(file) : '';
  },
  { immediate: true },
);
onUnmounted(() => yourPhoto.value && URL.revokeObjectURL(yourPhoto.value));

async function loadReference(s) {
  const key = keyOf(s);
  if (references[key] || session.config.referencePhotosEnabled === false || !s.scientificName) return;
  references[key] = { loading: true, photos: [], links: {} };
  try {
    const q = new URLSearchParams({ scientificName: s.scientificName, ...(s.commonName ? { commonName: s.commonName } : {}) });
    const info = await api.get(`/reference?${q}`);
    references[key] = { loading: false, photos: info.photos, links: info.links };
  } catch {
    references[key] = { loading: false, photos: [], links: {} };
  }
}
watch(visible, (list) => list.forEach(loadReference), { immediate: true });

async function acceptFromCompare() {
  const s = compare.value.s;
  compare.value = null;
  await accept(s);
}

const NEARBY = {
  recent: { label: 'Seen nearby this month', tone: 'good' },
  area: { label: 'Recorded near here', tone: 'ok' },
  elsewhere: { label: 'Not recorded near here', tone: 'warn' },
};

const locationNote = computed(() => {
  const loc = result.value?.location;
  const pool = result.value?.pool;
  if (!result.value) return '';
  if (!loc || loc.unused || !pool?.usedLocation) {
    return pool
      ? `Compared against the ${pool.candidates} species in this catalogue. Set a location to weight by birds recorded there.`
      : '';
  }
  const where = { pin: 'the map pin', photo: "the photo's GPS", catalogue: "this catalogue's area" }[loc.source];
  return `Using ${where}: ${pool.recordedNearby} species recorded within ${pool.radiusKm} km, ${pool.recentNearby} of them in the last 30 days.`;
});

function confidenceWord(c) {
  if (c >= 0.8) return 'Strong match';
  if (c >= 0.5) return 'Likely';
  if (c >= 0.2) return 'Possible';
  return 'Unlikely';
}

function emitDecision() {
  if (!result.value) return;
  emit('decision', {
    model: result.value.model,
    suggestions: result.value.suggestions.slice(0, 6).map((s) => ({
      ebirdCode: s.ebirdCode,
      scientificName: s.scientificName,
      commonName: s.commonName,
      confidence: s.confidence,
    })),
    accepted: acceptedKey.value,
    rejected: [...rejected.value],
  });
}

async function run() {
  error.value = '';
  loading.value = true;
  result.value = null;
  rejected.value = new Set();
  acceptedKey.value = null;
  showMore.value = false;
  try {
    const fields = {};
    if (props.latitude !== null && props.longitude !== null) {
      fields.latitude = String(props.latitude);
      fields.longitude = String(props.longitude);
    }
    result.value = await api.upload(`/catalogues/${props.catalogue}/identify`, props.file, fields);
    if (!result.value.suggestions.length) error.value = 'No suggestions for this photo.';
    emitDecision();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function accept(s) {
  busyKey.value = keyOf(s);
  error.value = '';
  try {
    let speciesId = s.speciesId;
    if (!s.inCatalogue) {
      const body = s.ebirdCode
        ? { ebirdCode: s.ebirdCode }
        : s.speciesId
          ? { speciesId: s.speciesId }
          : { commonName: s.commonName, scientificName: s.scientificName };
      const res = await api.post(`/catalogues/${props.catalogue}/species`, body);
      speciesId = res.entry.id;
      s.inCatalogue = true;
      s.speciesId = speciesId;
    }
    acceptedKey.value = keyOf(s);
    rejected.value.delete(keyOf(s));
    emit('accepted', speciesId);
    emitDecision();
  } catch (err) {
    error.value = err.message;
  } finally {
    busyKey.value = null;
  }
}

function reject(s) {
  const next = new Set(rejected.value);
  next.add(keyOf(s));
  rejected.value = next;
  if (acceptedKey.value === keyOf(s)) acceptedKey.value = null;
  emitDecision();
}

function noneOfThese() {
  const next = new Set(rejected.value);
  for (const s of visible.value) next.add(keyOf(s));
  rejected.value = next;
  acceptedKey.value = null;
  emitDecision();
  emit('none');
}

// The user picked a species by hand: count it as accepting that suggestion if it was one.
watch(
  () => props.selectedSpeciesId,
  (id) => {
    if (!result.value || !id) return;
    const match = result.value.suggestions.find((s) => s.speciesId === id);
    acceptedKey.value = match ? keyOf(match) : null;
    emitDecision();
  },
);

// Identify automatically when a photo is chosen (and again if it changes).
watch(
  () => props.file,
  () => {
    if (props.auto) run();
  },
  { immediate: true },
);

defineExpose({ run });
</script>

<template>
  <section class="ai" aria-live="polite">
    <div class="head">
      <h4>What bird is this?</h4>
      <button v-if="result || error" class="btn quiet small" type="button" :disabled="loading" @click="run">
        Ask again
      </button>
    </div>

    <p v-if="loading" class="soft">Looking at the photo. The first one after a restart can take a minute.</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>

    <template v-if="result && !loading">
      <p v-if="locationNote" class="soft small">{{ locationNote }}</p>
      <ol class="cards">
        <li v-for="(s, i) in visible" :key="keyOf(s)" :class="['card', { accepted: acceptedKey === keyOf(s) }]">
          <div class="rank">{{ i + 1 }}</div>
          <div class="body">
            <p class="names">
              <strong>{{ s.commonName }}</strong>
              <span class="sci soft small">{{ s.scientificName }}</span>
            </p>
            <div class="meter" role="img" :aria-label="`${Math.round(s.confidence * 100)} percent confidence`">
              <span :style="{ width: Math.max(2, Math.round(s.confidence * 100)) + '%' }"></span>
            </div>
            <p class="small meta">
              <span class="pct">{{ Math.round(s.confidence * 100) }}%</span>
              <span class="soft">{{ confidenceWord(s.confidence) }}</span>
              <span v-if="s.nearby" :class="['tag', NEARBY[s.nearby].tone]">{{ NEARBY[s.nearby].label }}</span>
              <span v-if="!s.inCatalogue" class="soft">Not in this catalogue yet</span>
            </p>
            <div v-if="references[keyOf(s)]?.photos.length" class="refs">
              <button
                v-for="(ph, j) in references[keyOf(s)].photos.slice(0, 3)"
                :key="ph.thumb"
                type="button"
                class="ref"
                :aria-label="`Compare your photo with example ${j + 1} of ${s.commonName}`"
                @click="compare = { s, start: j }"
              >
                <img :src="ph.thumb" alt="" loading="lazy" />
              </button>
              <button type="button" class="btn quiet small compare" @click="compare = { s, start: 0 }">Compare</button>
            </div>
            <p v-else-if="references[keyOf(s)]?.loading" class="soft small refs-note">Loading example photos...</p>
          </div>
          <div class="actions">
            <button
              v-if="acceptedKey !== keyOf(s)"
              class="btn primary"
              type="button"
              :disabled="busyKey === keyOf(s)"
              @click="accept(s)"
            >
              {{ busyKey === keyOf(s) ? 'Adding...' : 'Accept' }}
            </button>
            <span v-else class="ok-label">Accepted</span>
            <button class="btn quiet reject" type="button" :aria-label="`Reject ${s.commonName}`" @click="reject(s)">
              Reject
            </button>
          </div>
        </li>
      </ol>
      <div class="row">
        <button v-if="hiddenCount" class="btn quiet small" type="button" @click="showMore = true">
          Show {{ hiddenCount }} more
        </button>
        <button v-if="visible.length" class="btn quiet small" type="button" @click="noneOfThese">None of these</button>
      </div>
      <p v-if="!visible.length" class="soft small">
        You rejected every suggestion. Find the species below, or ask again with a tighter crop.
      </p>
      <p class="soft small">
        Suggestions can be wrong; you make the final call. Example photos are from iNaturalist and Wikipedia; click one to
        compare it with yours.
      </p>
    </template>

    <PhotoCompare
      v-if="compare"
      :your-photo="yourPhoto"
      :species="compare.s"
      :photos="references[keyOf(compare.s)].photos"
      :links="references[keyOf(compare.s)].links"
      :start="compare.start"
      @close="compare = null"
      @accept="acceptFromCompare"
    />
  </section>
</template>

<style scoped>
.ai {
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 18px;
  background: var(--paper-raised);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
h4 {
  font-family: var(--font-display);
  font-size: var(--step-1);
  margin: 0 0 6px;
}
.cards {
  list-style: none;
  padding: 0;
  margin: 10px 0;
  display: grid;
  gap: 8px;
}
.card {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper);
}
.card.accepted {
  border-color: var(--jay);
  background: var(--jay-wash);
}
.rank {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--step-1);
  color: var(--ink-soft);
  text-align: center;
}
.names {
  margin: 0 0 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}
.meter {
  height: 6px;
  border-radius: 3px;
  background: var(--rule);
  overflow: hidden;
  max-width: 320px;
}
.meter span {
  display: block;
  height: 100%;
  background: var(--jay);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 6px 0 0;
  align-items: center;
}
.pct {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tag {
  border-radius: 999px;
  padding: 0 8px;
  border: 1px solid currentColor;
}
.tag.good {
  color: var(--jay);
}
.tag.ok {
  color: var(--ink-soft);
}
.tag.warn {
  color: var(--goldfinch);
}
.refs {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}
.ref {
  padding: 0;
  border: 0;
  background: none;
  border-radius: 4px;
  overflow: hidden;
  cursor: zoom-in;
  display: block;
}
.ref img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  display: block;
}
.ref:hover {
  outline: 2px solid var(--jay);
  outline-offset: 1px;
}
.refs-note {
  margin: 8px 0 0;
}
.actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ok-label {
  font-weight: 700;
  color: var(--jay);
  padding: 0 8px;
}
.reject {
  color: var(--ink-soft);
}
@media (max-width: 560px) {
  .card {
    grid-template-columns: 24px 1fr;
  }
  .actions {
    grid-column: 2;
  }
}
</style>
