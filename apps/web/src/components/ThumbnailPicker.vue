<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { formatDate } from '../format.js';

// Choose which of your photos represents a species in the dex.
const props = defineProps({
  photos: { type: Array, required: true }, // newest first
  currentId: { type: Number, default: null },
  chosen: { type: Boolean, default: false }, // false = the newest photo is used automatically
  commonName: { type: String, required: true },
  saving: { type: Boolean, default: false },
});
const emit = defineEmits(['choose', 'close']);

const closeBtn = ref(null);
let lastFocus = null;
function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(async () => {
  lastFocus = document.activeElement;
  window.addEventListener('keydown', onKey);
  await nextTick();
  closeBtn.value?.focus();
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  lastFocus?.focus?.();
});
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" :aria-label="`Choose the thumbnail for ${commonName}`" @click.self="emit('close')">
    <div class="panel">
      <header>
        <div>
          <h3>Choose the thumbnail</h3>
          <p class="soft small">This photo represents the {{ commonName }} in the dex, families and season lists.</p>
        </div>
        <button ref="closeBtn" class="btn" type="button" @click="emit('close')">Close</button>
      </header>

      <label class="auto">
        <input type="radio" name="thumb" :checked="!chosen" :disabled="saving" @change="emit('choose', null)" />
        <span>
          <strong>Always use my newest photo</strong>
          <span class="soft small">The thumbnail updates whenever you add a photo.</span>
        </span>
      </label>

      <ul class="grid">
        <li v-for="p in photos" :key="p.id">
          <button
            type="button"
            :class="['tile', { current: p.id === currentId }]"
            :aria-pressed="chosen && p.id === currentId"
            :disabled="saving"
            @click="emit('choose', p.id)"
          >
            <img :src="p.urls.thumb" :alt="`Photo from ${formatDate(p.takenAt || p.createdAt)}`" loading="lazy" />
            <span class="caption small">
              {{ formatDate(p.takenAt || p.createdAt) }}
            </span>
            <span v-if="p.id === currentId" class="badge small">{{ chosen ? 'Thumbnail' : 'Thumbnail (newest)' }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(10 14 12 / 0.6);
  display: grid;
  place-items: center;
  padding: 16px;
}
.panel {
  width: min(960px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: var(--paper);
  border-radius: var(--radius);
  padding: 18px 20px 20px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
h3 {
  margin: 0 0 2px;
}
header p {
  margin: 0;
}
.auto {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  margin-bottom: 14px;
  cursor: pointer;
}
.auto input {
  margin-top: 4px;
}
.auto > span {
  display: grid;
}
.grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.tile {
  position: relative;
  display: grid;
  width: 100%;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius);
  background: var(--paper-raised);
  cursor: pointer;
  overflow: hidden;
  text-align: left;
  font: inherit;
  color: inherit;
}
.tile img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.tile:hover {
  border-color: var(--rule);
}
.tile.current {
  border-color: var(--jay);
}
.caption {
  padding: 6px 8px;
  color: var(--ink-soft);
}
.badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: var(--jay);
  color: #fff;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 9px;
}
</style>
