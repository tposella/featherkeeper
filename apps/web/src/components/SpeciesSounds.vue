<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';

// Recordings of the species' song and calls, with the recordist's credit and licence.
const props = defineProps({
  catalogue: { type: String, required: true },
  speciesId: { type: Number, required: true },
  commonName: { type: String, required: true },
});

const sounds = ref([]);
const provider = ref('');
const loading = ref(true);
const failed = ref(false);
const filter = ref('all');
const playing = ref(null);
const players = ref({});

onMounted(async () => {
  try {
    const res = await api.get(`/catalogues/${props.catalogue}/species/${props.speciesId}/sounds`);
    sounds.value = res.sounds;
    provider.value = res.provider;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});

const kinds = computed(() => {
  const k = new Set(sounds.value.map((s) => s.kind).filter(Boolean));
  return ['song', 'call', 'drumming'].filter((x) => k.has(x));
});
const shown = computed(() => (filter.value === 'all' ? sounds.value : sounds.value.filter((s) => s.kind === filter.value)));
const LABEL = { song: 'Song', call: 'Call', drumming: 'Drumming' };

// Only one recording plays at a time.
function onPlay(i) {
  for (const [k, el] of Object.entries(players.value)) if (Number(k) !== i && el && !el.paused) el.pause();
  playing.value = i;
}
</script>

<template>
  <section v-if="loading || sounds.length || failed" class="sounds">
    <div class="head">
      <h3>Calls and songs</h3>
      <div v-if="kinds.length > 1" class="seg" role="radiogroup" aria-label="Show recordings">
        <button type="button" role="radio" :aria-checked="filter === 'all'" :class="{ on: filter === 'all' }" @click="filter = 'all'">
          All
        </button>
        <button
          v-for="k in kinds"
          :key="k"
          type="button"
          role="radio"
          :aria-checked="filter === k"
          :class="{ on: filter === k }"
          @click="filter = k"
        >
          {{ LABEL[k] }}s
        </button>
      </div>
    </div>

    <p v-if="loading" class="soft">Finding recordings...</p>
    <p v-else-if="failed" class="soft small">Recordings couldn’t be loaded right now.</p>

    <ol v-else class="list">
      <li v-for="(s, i) in shown" :key="s.url" :class="{ active: playing === i }">
        <div class="top">
          <span class="what">
            <strong>{{ s.kind ? LABEL[s.kind] : 'Recording' }}</strong>
            <span v-if="s.type && s.type.toLowerCase() !== s.kind" class="soft small">{{ s.type }}</span>
            <span v-if="s.quality" class="q small" :title="`xeno-canto quality rating ${s.quality} (A is best)`">Quality {{ s.quality }}</span>
          </span>
          <span v-if="s.where" class="soft small where">{{ s.where }}</span>
        </div>
        <audio
          :ref="(el) => (players[i] = el)"
          :src="s.url"
          controls
          preload="none"
          :aria-label="`${commonName} ${s.kind || 'recording'}${s.where ? `, recorded at ${s.where}` : ''}`"
          @play="onPlay(i)"
        ></audio>
        <p class="credit small soft">
          {{ s.credit }}<template v-if="s.licence && !s.credit.includes(s.licence)">, {{ s.licence }}</template>.
          <a :href="s.page" target="_blank" rel="noopener">{{ s.source }}</a>
        </p>
      </li>
    </ol>
    <p v-if="!loading && !failed && !sounds.length" class="soft">No openly licensed recordings found for {{ commonName }}.</p>
    <p v-if="!loading && sounds.length" class="soft small note">
      Recordings from
      <template v-if="provider === 'xeno-canto'"><a href="https://xeno-canto.org" target="_blank" rel="noopener">xeno-canto</a> and </template>
      <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>, nearest to this catalogue first. Please don’t
      play calls to birds in the field; it can stress them, especially during nesting.
    </p>
  </section>
</template>

<style scoped>
.sounds {
  margin-bottom: 36px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.seg {
  display: flex;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  overflow: hidden;
}
.seg button {
  font: inherit;
  font-size: var(--step--1);
  font-weight: 700;
  border: 0;
  border-right: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-soft);
  padding: 5px 12px;
  cursor: pointer;
}
.seg button:last-child {
  border-right: 0;
}
.seg button.on {
  background: var(--ink);
  color: var(--paper);
}
.list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 10px;
}
.list li {
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  padding: 10px 12px;
  display: grid;
  gap: 6px;
}
.list li.active {
  border-color: var(--jay);
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  align-items: baseline;
}
.what {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
.q {
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 0 8px;
}
.where {
  text-align: right;
}
audio {
  width: 100%;
  height: 36px;
}
.credit {
  margin: 0;
}
.note {
  margin-top: 10px;
}
</style>
