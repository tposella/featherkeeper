<script setup>
import { computed } from 'vue';

// Photographed (jay blue) and logged-without-photo (goldfinch) as one bar.
const props = defineProps({
  photographed: { type: Number, required: true },
  logged: { type: Number, default: 0 },
  total: { type: Number, required: true },
});
const pct = (n) => (props.total ? Math.min(100, (n / props.total) * 100) : 0);
const photoPct = computed(() => pct(props.photographed));
const loggedPct = computed(() => pct(Math.max(0, props.logged - props.photographed)));
</script>

<template>
  <div
    class="bar"
    role="img"
    :aria-label="`${photographed} of ${total} species photographed`"
  >
    <span class="photo" :style="{ width: photoPct + '%' }"></span>
    <span class="logged" :style="{ width: loggedPct + '%' }"></span>
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
.logged {
  background: var(--goldfinch);
}
</style>
