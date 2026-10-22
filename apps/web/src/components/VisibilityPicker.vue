<script setup>
const model = defineModel({ type: String, required: true });

const options = [
  { value: 'private', label: 'Private', hint: 'Only you and your editors can see it.' },
  { value: 'members', label: 'Signed-in users', hint: 'Anyone with an account on this site can view it.' },
  { value: 'public', label: 'Public', hint: 'Anyone with the link can view it, no sign-in needed.' },
];
</script>

<template>
  <fieldset class="vis">
    <legend>Who can view</legend>
    <label v-for="o in options" :key="o.value" class="opt" :class="{ on: model === o.value }">
      <input v-model="model" type="radio" name="visibility" :value="o.value" />
      <span>
        <strong>{{ o.label }}</strong>
        <span class="soft small">{{ o.hint }}</span>
      </span>
    </label>
  </fieldset>
</template>

<style scoped>
.vis {
  border: 0;
  padding: 0;
  margin: 0 0 18px;
}
legend {
  font-weight: 700;
  margin-bottom: 8px;
}
.opt {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  margin-bottom: 8px;
  cursor: pointer;
}
.opt.on {
  border-color: var(--jay);
  background: var(--jay-wash);
}
.opt input {
  margin-top: 4px;
}
.opt > span {
  display: grid;
}
</style>
