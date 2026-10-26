<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import { formatDate } from '../format.js';

const { catalogue } = useCatalogue();
const sightings = ref([]);
const loading = ref(true);
const error = ref('');
// 50 at a time, so catalogues with thousands of sightings still open quickly.
const PAGE = 50;
const nextOffset = ref(0);
const total = ref(0);

async function loadMore() {
  loading.value = true;
  try {
    const res = await api.get(`/catalogues/${catalogue.value.slug}/sightings?limit=${PAGE}&offset=${nextOffset.value}`);
    sightings.value.push(...res.sightings);
    nextOffset.value = res.nextOffset;
    total.value = res.total;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
onMounted(loadMore);
</script>

<template>
  <div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <p v-else-if="!loading && !sightings.length" class="empty">No sightings logged yet.</p>
    <ol class="feed">
      <li v-for="s in sightings" :key="s.id">
        <RouterLink :to="{ name: 'species', params: { slug: catalogue.slug, speciesId: s.speciesId } }" class="item">
          <span class="pic">
            <img v-if="s.thumbUrl" :src="s.thumbUrl" alt="" loading="lazy" />
          </span>
          <span class="text">
            <strong>{{ s.commonName }}</strong>
            <span class="sci soft small">{{ s.scientificName }}</span>
            <span class="soft small">
              {{ s.observedAt ? formatDate(s.observedAt, true) : 'Date not recorded' }}<template v-if="s.locationName">,
              {{ s.locationName }}</template>
            </span>
          </span>
          <span class="soft small n">{{ s.photoCount }} photo{{ s.photoCount === 1 ? '' : 's' }}</span>
        </RouterLink>
      </li>
    </ol>
    <div v-if="nextOffset !== null && sightings.length" class="more">
      <button class="btn" type="button" :disabled="loading" @click="loadMore">
        {{ loading ? 'Loading...' : `Show more (${sightings.length} of ${total})` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.feed {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
  color: inherit;
  text-decoration: none;
}
.item:hover strong {
  color: var(--jay);
}
.pic {
  width: 64px;
  height: 64px;
  border-radius: var(--radius);
  overflow: hidden;
  background: transparent;
  border: 1.5px dashed var(--rule);
}
.pic:has(img) {
  border: 0;
}
.pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.text {
  display: grid;
}
.more {
  margin-top: 16px;
  text-align: center;
}
</style>
