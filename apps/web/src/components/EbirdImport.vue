<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import AreaPicker from './AreaPicker.vue';

/**
 * Choose where species come from (hotspots around a place, or a whole eBird region),
 * preview the list, pick what to keep, then emit `submit` with the import request.
 */
const props = defineProps({
  catalogue: { type: String, default: null }, // slug, to mark species already in it
  initialArea: { type: Object, default: null },
  initialRegion: { type: String, default: '' },
  submitLabel: { type: Function, required: true }, // (count) => button text
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['submit']);

const mode = ref('area');
const area = ref({
  latitude: props.initialArea?.latitude ?? null,
  longitude: props.initialArea?.longitude ?? null,
  radiusKm: props.initialArea?.radiusKm ?? 25,
  label: props.initialArea?.label ?? '',
});
const regionCode = ref(props.initialRegion);

const preview = ref(null);
const picked = ref(new Set());
const loading = ref(false);
const error = ref('');
const showAll = ref(false);

const ready = computed(() => (mode.value === 'area' ? area.value.latitude !== null : regionCode.value.trim().length >= 2));
const fresh = computed(() => preview.value?.species.filter((s) => !s.inCatalogue) ?? []);
const families = computed(() => new Set(preview.value?.species.map((s) => s.familyCommon)).size);
const listed = computed(() => (showAll.value ? preview.value.species : preview.value.species.slice(0, 60)));

function source() {
  if (mode.value === 'region') return { regionCode: regionCode.value.trim().toUpperCase() };
  const { latitude, longitude, radiusKm, label } = area.value;
  return { latitude, longitude, radiusKm, ...(label ? { areaLabel: label } : {}) };
}

// Any change to the source makes the old preview stale.
watch([mode, area, regionCode], () => {
  preview.value = null;
  error.value = '';
});

async function loadPreview() {
  error.value = '';
  loading.value = true;
  try {
    preview.value = await api.post('/ebird/preview', { ...source(), ...(props.catalogue ? { catalogue: props.catalogue } : {}) });
    picked.value = new Set(fresh.value.map((s) => s.ebirdCode));
    showAll.value = false;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function useDistrict() {
  regionCode.value = preview.value.source.regionCode;
  mode.value = 'region';
  // The watch clears the preview; load the region's list straight away.
  setTimeout(loadPreview);
}

function toggle(code) {
  const next = new Set(picked.value);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  picked.value = next;
}
function pickAll(on) {
  picked.value = new Set(on ? fresh.value.map((s) => s.ebirdCode) : []);
}

function submit() {
  emit('submit', { ...source(), codes: [...picked.value] });
}

const summary = computed(() => {
  const s = preview.value?.source;
  if (!s) return '';
  if (s.kind === 'region') return `eBird has records of ${preview.value.species.length} species in ${s.regionName}.`;
  const where = area.value.label || 'this spot';
  return `${preview.value.species.length} species have been recorded at ${s.hotspotsUsed} eBird hotspots within ${s.radiusKm} km of ${where}.`;
});
</script>

<template>
  <div class="import">
    <div class="modes" role="radiogroup" aria-label="Where species come from">
      <label :class="{ on: mode === 'area' }">
        <input v-model="mode" type="radio" value="area" />
        <span>
          <strong>Around a town or place</strong>
          <span class="soft small">Birds recorded at eBird hotspots within a distance you choose.</span>
        </span>
      </label>
      <label :class="{ on: mode === 'region' }">
        <input v-model="mode" type="radio" value="region" />
        <span>
          <strong>A whole region</strong>
          <span class="soft small">Every bird recorded in a province, state, county or country.</span>
        </span>
      </label>
    </div>

    <AreaPicker v-if="mode === 'area'" v-model="area" />
    <label v-else class="field">
      <span>eBird region code</span>
      <input v-model="regionCode" type="text" maxlength="20" placeholder="CA-AB" />
      <span class="hint">
        CA-AB is Alberta, US-WA is Washington. Find a code on any eBird region page, for example
        <a href="https://ebird.org/region/CA-AB" target="_blank" rel="noopener">ebird.org/region/CA-AB</a>.
      </span>
    </label>

    <div class="row actions">
      <button class="btn" type="button" :disabled="!ready || loading" @click="loadPreview">
        {{ loading ? 'Asking eBird...' : preview ? 'Refresh list' : 'Find species' }}
      </button>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <div v-if="preview" class="preview">
      <p class="lead">{{ summary }}</p>
      <p v-if="preview.source.kind === 'area' && preview.source.topHotspots?.length" class="soft small">
        Richest hotspots: {{ preview.source.topHotspots.map((h) => `${h.name} (${h.species})`).join(', ') }}.
      </p>
      <p v-if="preview.source.kind === 'area' && preview.source.regionCode" class="soft small">
        Want a broader list?
        <button class="btn quiet small" type="button" @click="useDistrict">
          Use all of {{ preview.source.regionName || preview.source.regionCode }} instead
        </button>
      </p>

      <p class="small">
        <strong>{{ picked.size }}</strong> of {{ fresh.length }} new species selected, across {{ families }} families.
        <template v-if="fresh.length < preview.species.length">
          {{ preview.species.length - fresh.length }} are already in the catalogue.
        </template>
      </p>
      <div class="row">
        <button class="btn quiet small" type="button" @click="pickAll(true)">Select all</button>
        <button class="btn quiet small" type="button" @click="pickAll(false)">Select none</button>
      </div>
      <ul class="pick-list">
        <li v-for="s in listed" :key="s.ebirdCode">
          <label :class="{ have: s.inCatalogue }">
            <input
              type="checkbox"
              :checked="s.inCatalogue || picked.has(s.ebirdCode)"
              :disabled="s.inCatalogue"
              @change="toggle(s.ebirdCode)"
            />
            <span>{{ s.commonName }}</span>
            <span class="sci soft small">{{ s.scientificName }}</span>
          </label>
        </li>
      </ul>
      <button v-if="!showAll && preview.species.length > 60" class="btn quiet small" type="button" @click="showAll = true">
        Show all {{ preview.species.length }}
      </button>

      <div class="row submit">
        <button class="btn primary" type="button" :disabled="busy || !picked.size" @click="submit">
          {{ submitLabel(picked.size) }}
        </button>
        <slot name="secondary" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}
.modes label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  cursor: pointer;
}
.modes label.on {
  border-color: var(--jay);
  background: var(--jay-wash);
}
.modes input {
  margin-top: 4px;
}
.modes label > span {
  display: grid;
}
.actions {
  margin: 16px 0;
}
.preview {
  border-top: 1px solid var(--rule);
  padding-top: 16px;
}
.lead {
  font-family: var(--font-display);
  font-size: var(--step-1);
  font-weight: 600;
  line-height: 1.3;
}
.pick-list {
  list-style: none;
  padding: 0;
  margin: 10px 0;
  columns: 2 260px;
  column-gap: 24px;
}
.pick-list label {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 2px 0;
  break-inside: avoid;
}
.pick-list label.have {
  color: var(--ink-soft);
}
.submit {
  margin-top: 16px;
}
</style>
