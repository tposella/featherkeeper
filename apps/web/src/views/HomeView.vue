<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import ProgressBar from '../components/ProgressBar.vue';
import { visibilityLabels } from '../format.js';
import { session } from '../session.js';

const catalogues = ref([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    catalogues.value = (await api.get('/catalogues')).catalogues;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <div class="head">
      <h1>Catalogues</h1>
      <RouterLink v-if="session.user" to="/new" class="btn primary">New catalogue</RouterLink>
    </div>

    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <div v-if="session.config.needsSetup" class="notice">
      Welcome to Featherkeeper. <RouterLink to="/register">Create the admin account</RouterLink> to get started.
    </div>

    <p v-else-if="!loading && !catalogues.length" class="empty">
      <template v-if="session.user">
        You have no catalogues yet. <RouterLink to="/new">Create your first one</RouterLink> to start your dex.
      </template>
      <template v-else>
        Nothing is shared publicly on this site yet. <RouterLink to="/login">Sign in</RouterLink> to see your catalogues.
      </template>
    </p>

    <ul class="cards">
      <li v-for="c in catalogues" :key="c.id">
        <RouterLink :to="`/c/${c.slug}`" class="card">
          <div class="cover">
            <img v-if="c.coverUrl" :src="c.coverUrl" alt="" loading="lazy" />
          </div>
          <div class="body">
            <h2>{{ c.name }}</h2>
            <p class="meta soft small">
              {{ c.ownerName }}<template v-if="c.regionCode">, {{ c.regionCode }}</template>
            </p>
            <ProgressBar :photographed="c.stats.photographed" :logged="c.stats.logged" :total="c.stats.species" />
            <p class="count small">
              <strong>{{ c.stats.photographed }}</strong> of {{ c.stats.species }} photographed
            </p>
            <p v-if="c.access.role || c.visibility !== 'public'" class="tags small">
              <span v-if="c.access.role" class="tag">{{ c.access.role === 'owner' ? 'Yours' : 'Editor' }}</span>
              <span class="tag soft">{{ visibilityLabels[c.visibility] }}</span>
            </p>
          </div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
.cards {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}
.card {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
}
.card:hover {
  border-color: var(--ink-soft);
}
.cover {
  aspect-ratio: 16 / 9;
  background: var(--rule);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.body {
  padding: 14px 16px 16px;
}
.body h2 {
  font-size: var(--step-1);
  margin-bottom: 2px;
}
.meta {
  margin-bottom: 12px;
}
.count {
  margin: 6px 0 0;
}
.tags {
  display: flex;
  gap: 8px;
  margin: 10px 0 0;
}
.tag {
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 1px 9px;
}
</style>
