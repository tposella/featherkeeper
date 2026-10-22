<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import EbirdImport from '../components/EbirdImport.vue';
import VisibilityPicker from '../components/VisibilityPicker.vue';
import { session } from '../session.js';

const router = useRouter();
const name = ref('');
const description = ref('');
const visibility = ref('private');
const error = ref('');
const busy = ref(false);
const progress = ref('');

async function create(importRequest) {
  error.value = '';
  if (!name.value.trim()) {
    error.value = 'Give the catalogue a name first.';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  busy.value = true;
  let catalogue = null;
  try {
    progress.value = 'Creating the catalogue...';
    catalogue = (
      await api.post('/catalogues', {
        name: name.value,
        description: description.value,
        visibility: visibility.value,
        ...(importRequest?.regionCode ? { regionCode: importRequest.regionCode } : {}),
      })
    ).catalogue;
    if (importRequest) {
      progress.value = `Adding ${importRequest.codes.length} species...`;
      await api.post(`/catalogues/${catalogue.slug}/import/ebird`, importRequest);
    }
    router.push(`/c/${catalogue.slug}`);
  } catch (err) {
    error.value = catalogue
      ? `The catalogue was created, but adding species failed: ${err.message} You can try again from its Settings.`
      : err.message;
    if (catalogue) setTimeout(() => router.push(`/c/${catalogue.slug}/settings#species`), 2500);
  } finally {
    busy.value = false;
    progress.value = '';
  }
}
</script>

<template>
  <div class="page new">
    <h1>New catalogue</h1>
    <p class="soft">A catalogue is one checklist of species, such as your backyard, a park or a whole province.</p>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <section>
      <label class="field">
        <span>Name</span>
        <input v-model="name" type="text" maxlength="120" required placeholder="Bow Valley birds" />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea v-model="description" maxlength="4000"></textarea>
      </label>
      <VisibilityPicker v-model="visibility" />
    </section>

    <section>
      <h2>Starting species</h2>
      <template v-if="session.config.ebirdEnabled">
        <p class="soft">
          Fill the dex with the birds eBird users have recorded near you. You can add or remove species later.
        </p>
        <EbirdImport
          :busy="busy"
          :submit-label="(n) => `Create catalogue with ${n} species`"
          @submit="create"
        >
          <template #secondary>
            <span v-if="progress" class="soft" role="status">{{ progress }}</span>
          </template>
        </EbirdImport>
        <p class="empty-start">
          <button class="btn quiet" type="button" :disabled="busy" @click="create(null)">
            Or create it empty and add species by hand
          </button>
        </p>
      </template>
      <template v-else>
        <p class="soft">
          eBird import is switched off on this site (the admin can enable it with EBIRD_API_KEY). Create the catalogue,
          then add species by hand from its Settings.
        </p>
        <button class="btn primary" type="button" :disabled="busy" @click="create(null)">Create catalogue</button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.new {
  max-width: 760px;
}
section {
  margin-bottom: 40px;
}
.empty-start {
  margin-top: 20px;
  border-top: 1px solid var(--rule);
  padding-top: 12px;
}
</style>
