<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import { formatDate } from '../format.js';

// Photos marked "want to replace": the shots worth going back out for.
const { catalogue, reload, reloadDex } = useCatalogue();
const photos = ref([]);
const loading = ref(true);
const error = ref('');
const sort = ref('marked');
const busy = ref(null);

async function load() {
  try {
    photos.value = (await api.get(`/catalogues/${catalogue.value.slug}/to-replace`)).photos;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const shown = computed(() => {
  const list = [...photos.value];
  if (sort.value === 'taxonomic') {
    list.sort((a, b) => (a.species.taxonSort ?? 1e9) - (b.species.taxonSort ?? 1e9) || a.species.commonName.localeCompare(b.species.commonName));
  }
  return list;
});
const speciesCount = computed(() => new Set(photos.value.map((p) => p.species.id)).size);

async function unmark(p) {
  busy.value = p.id;
  error.value = '';
  try {
    await api.patch(`/photos/${p.id}`, { replace: false });
    photos.value = photos.value.filter((x) => x.id !== p.id);
    await reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = null;
  }
}

async function remove(p) {
  const last = p.speciesPhotoCount <= 1;
  const msg = last
    ? `This is your only photo of the ${p.species.commonName}. Deleting it also deletes its sighting, and the species goes back to "not yet photographed". Delete it anyway?`
    : `Delete this photo of the ${p.species.commonName}? If it's the only photo of its sighting, the sighting is deleted too. This cannot be undone.`;
  if (!confirm(msg)) return;
  busy.value = p.id;
  error.value = '';
  try {
    await api.del(`/photos/${p.id}`);
    photos.value = photos.value.filter((x) => x.id !== p.id);
    await Promise.all([reload(), reloadDex()]);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <div v-if="!loading && !error && !photos.length" class="empty-state">
      <h2>Nothing to replace</h2>
      <p class="soft">
        When a photo isn’t as good as you’d like, open it on the species page and choose <strong>Want to replace</strong>. It’ll be
        listed here until you get a better one.
      </p>
    </div>

    <template v-else-if="photos.length">
      <div class="bar">
        <p class="soft">
          {{ photos.length }} photo{{ photos.length === 1 ? '' : 's' }} of {{ speciesCount }} species
          {{ photos.length === 1 ? 'is' : 'are' }} marked to replace.
        </p>
        <label class="sort small">
          Sort by
          <select v-model="sort">
            <option value="marked">Recently marked</option>
            <option value="taxonomic">Taxonomic order</option>
          </select>
        </label>
      </div>

      <ol class="list">
        <li v-for="p in shown" :key="p.id" class="card">
          <RouterLink
            :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: p.species.id }, query: { photo: p.id } }"
            class="pic"
            :aria-label="`Open this photo of the ${p.species.commonName}`"
          >
            <img :src="p.urls.thumb" alt="" loading="lazy" />
            <span v-if="p.isCover" class="chip small">Thumbnail</span>
          </RouterLink>
          <div class="body">
            <RouterLink :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: p.species.id } }" class="name">
              {{ p.species.commonName }}
            </RouterLink>
            <span class="sci soft small">{{ p.species.scientificName }}</span>
            <span class="soft small">
              {{ formatDate(p.takenAt || p.sighting.observedAt || p.createdAt) }}<template v-if="p.sighting.locationName">
                · {{ p.sighting.locationName }}</template
              >
            </span>
            <p v-if="p.replace?.note" class="note">“{{ p.replace.note }}”</p>
            <p v-if="p.replace?.markedAt" class="soft small marked">Marked {{ formatDate(p.replace.markedAt) }}</p>
            <p v-if="p.newerPhotos" class="newer small" role="note">
              {{ p.newerPhotos }} newer photo{{ p.newerPhotos === 1 ? '' : 's' }} of this species since you marked it. Replaced already?
            </p>
            <div class="row actions">
              <RouterLink
                :to="{ name: 'log', params: { slug: catalogue.slug }, query: { species: p.species.id } }"
                class="btn primary"
              >
                Log a new sighting
              </RouterLink>
              <button class="btn quiet" type="button" :disabled="busy === p.id" @click="unmark(p)">Unmark</button>
              <button class="btn quiet danger-text" type="button" :disabled="busy === p.id" @click="remove(p)">Delete photo</button>
            </div>
          </div>
        </li>
      </ol>
    </template>
    <p v-else-if="loading" class="soft">Loading...</p>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.bar p {
  margin: 0;
}
.sort {
  white-space: nowrap;
  display: flex;
  gap: 8px;
  align-items: center;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: 12px;
}
.card {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
}
.pic {
  position: relative;
  display: block;
  width: 140px;
  height: 140px;
  border-radius: var(--radius);
  overflow: hidden;
  outline-offset: 2px;
}
.pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pic:hover,
.pic:focus-visible {
  outline: 2px solid var(--jay);
}
.chip {
  position: absolute;
  top: 6px;
  left: 6px;
  background: var(--jay);
  color: #fff;
  font-weight: 700;
  border-radius: 999px;
  padding: 0 8px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--step-1);
  color: inherit;
  text-decoration: none;
}
.name:hover {
  color: var(--jay);
}
.note {
  margin: 6px 0 0;
}
.marked {
  margin: 2px 0 0;
}
.newer {
  margin: 6px 0 0;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--goldfinch-wash);
}
.actions {
  margin-top: auto;
  padding-top: 8px;
  gap: 6px 10px;
}
.danger-text {
  color: var(--danger);
}
.empty-state {
  padding: 24px 0;
  max-width: 60ch;
}
@media (max-width: 520px) {
  .card {
    grid-template-columns: 96px 1fr;
  }
  .pic {
    width: 96px;
    height: 96px;
  }
}
</style>
