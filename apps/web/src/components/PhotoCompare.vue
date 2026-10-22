<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

// Your photo next to reference photos of a suggested species.
const props = defineProps({
  yourPhoto: { type: String, required: true }, // object URL of the uploaded file
  species: { type: Object, required: true }, // { commonName, scientificName }
  photos: { type: Array, required: true },
  start: { type: Number, default: 0 },
  links: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['close', 'accept']);

const index = ref(props.start);
const current = computed(() => props.photos[index.value]);
const closeBtn = ref(null);

function step(d) {
  index.value = (index.value + d + props.photos.length) % props.photos.length;
}
function onKey(e) {
  if (e.key === 'Escape') emit('close');
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
}
let lastFocus = null;
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
  <div class="overlay" role="dialog" aria-modal="true" :aria-label="`Compare with ${species.commonName}`" @click.self="emit('close')">
    <div class="panel">
      <header>
        <h3>
          {{ species.commonName }} <span class="sci">{{ species.scientificName }}</span>
        </h3>
        <button ref="closeBtn" class="btn" type="button" @click="emit('close')">Close</button>
      </header>
      <div class="pair">
        <figure>
          <img :src="yourPhoto" alt="Your photo" />
          <figcaption>Your photo</figcaption>
        </figure>
        <figure>
          <img :key="current.url" :src="current.url" :alt="`Reference photo of ${species.commonName}`" @error="$event.target.src = current.medium" />
          <figcaption>
            <span v-if="photos.length > 1" class="nav">
              <button type="button" aria-label="Previous reference photo" @click="step(-1)">&lsaquo;</button>
              {{ index + 1 }} of {{ photos.length }}
              <button type="button" aria-label="Next reference photo" @click="step(1)">&rsaquo;</button>
            </span>
            <span class="credit">
              {{ current.credit }}<template v-if="current.licence && !current.credit.includes(current.licence)">, {{ current.licence }}</template>.
              <a :href="current.page" target="_blank" rel="noopener">{{ current.source }}</a>
            </span>
          </figcaption>
        </figure>
      </div>
      <footer>
        <span class="links">
          <a v-if="links.inaturalist" :href="links.inaturalist" target="_blank" rel="noopener">More photos on iNaturalist</a>
          <a v-if="links.wikipedia" :href="links.wikipedia" target="_blank" rel="noopener">Wikipedia</a>
        </span>
        <button class="btn primary" type="button" @click="emit('accept')">Accept {{ species.commonName }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(10 14 12 / 0.97);
  display: grid;
  place-items: center;
  padding: 16px;
  overflow: auto;
}
.panel {
  width: min(1300px, 100%);
  color: #e2e8e3;
  display: grid;
  gap: 12px;
}
header,
footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
h3 {
  margin: 0;
  color: #fff;
}
.sci {
  font-family: var(--font-body);
  font-style: italic;
  font-weight: 400;
  font-size: var(--step-0);
  color: #aab5ae;
  margin-left: 6px;
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
figure {
  margin: 0;
  display: grid;
  gap: 8px;
  align-content: start;
}
figure img {
  width: 100%;
  height: min(62vh, 640px);
  object-fit: contain;
  background: #000;
  border-radius: var(--radius);
}
figcaption {
  font-size: var(--step--1);
  color: #aab5ae;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
}
.nav {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #e2e8e3;
}
.nav button {
  font: inherit;
  font-size: 1.4rem;
  line-height: 1;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #5d6a62;
  background: transparent;
  color: #e2e8e3;
  cursor: pointer;
}
a {
  color: #8cc0dc;
}
.links {
  display: flex;
  gap: 16px;
}
footer .btn.primary {
  background: #2c6a8a;
  border-color: #2c6a8a;
  color: #fff;
}
@media (max-width: 700px) {
  .pair {
    grid-template-columns: 1fr;
  }
  figure img {
    height: 36vh;
  }
}
</style>
