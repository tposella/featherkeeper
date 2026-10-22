<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import VisibilityPicker from '../components/VisibilityPicker.vue';

const router = useRouter();
const name = ref('');
const description = ref('');
const regionCode = ref('');
const visibility = ref('private');
const error = ref('');
const busy = ref(false);

async function create() {
  error.value = '';
  busy.value = true;
  try {
    const { catalogue } = await api.post('/catalogues', {
      name: name.value,
      description: description.value,
      regionCode: regionCode.value || null,
      visibility: visibility.value,
    });
    router.push(`/c/${catalogue.slug}/settings`);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page narrow">
    <h1>New catalogue</h1>
    <p class="soft">A catalogue is one checklist of species, such as your backyard, a park or a whole province.</p>
    <form @submit.prevent="create">
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <label class="field">
        <span>Name</span>
        <input v-model="name" type="text" maxlength="120" required placeholder="Bow Valley birds" />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea v-model="description" maxlength="4000"></textarea>
      </label>
      <label class="field">
        <span>eBird region code</span>
        <input v-model="regionCode" type="text" maxlength="20" placeholder="CA-AB" />
        <span class="hint">Used to import the species list. Province or state codes look like CA-AB or US-WA.</span>
      </label>
      <VisibilityPicker v-model="visibility" />
      <button class="btn primary" type="submit" :disabled="busy">Create catalogue</button>
    </form>
  </div>
</template>
