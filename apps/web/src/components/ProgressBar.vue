<script setup>
import { computed } from 'vue';

// How much of the dex is photographed.
const props = defineProps({
  photographed: { type: Number, required: true },
  total: { type: Number, required: true },
});
const pct = (n) => (props.total ? Math.min(100, (n / props.total) * 100) : 0);
const photoPct = computed(() => pct(props.photographed));
</script>

<template>
  <div
    class="bar"
    role="img"
    :aria-label="`${photographed} of ${total} species photographed`"
  >
    <span class="photo" :style="{ width: photoPct + '%' }"></span>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  background: var(--rule);
  overflow: hidden;
}
.photo {
  background: var(--jay);
}
</style>
