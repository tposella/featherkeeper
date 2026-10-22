<script setup>
import { loadSession } from '../session.js';
import { demo } from './server.js';

const emit = defineEmits(['switched']);

const roles = [
  { value: 'owner', label: 'Owner' },
  { value: 'editor', label: 'Editor' },
  { value: 'visitor', label: 'Visitor (signed out)' },
];

async function choose(value) {
  demo.viewAs = value;
  await loadSession();
  emit('switched');
}
</script>

<template>
  <div class="demo-banner" role="region" aria-label="Demo controls">
    <p>Demo with sample data. Photos are placeholders and changes reset when you reload.</p>
    <div class="seg" role="radiogroup" aria-label="View as">
      <span class="label">View as</span>
      <button
        v-for="r in roles"
        :key="r.value"
        type="button"
        role="radio"
        :aria-checked="demo.viewAs === r.value"
        :class="{ on: demo.viewAs === r.value }"
        @click="choose(r.value)"
      >
        {{ r.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.demo-banner {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px 16px;
  padding: 8px var(--gutter);
  background: var(--goldfinch-wash);
  border-bottom: 1px solid var(--goldfinch);
  font-size: var(--step--1);
}
.demo-banner p {
  margin: 0;
}
.seg {
  display: flex;
  align-items: center;
  gap: 4px;
}
.label {
  margin-right: 4px;
  font-weight: 700;
}
button {
  font: inherit;
  border: 1px solid var(--goldfinch);
  background: transparent;
  color: var(--ink);
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
}
button.on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
</style>
