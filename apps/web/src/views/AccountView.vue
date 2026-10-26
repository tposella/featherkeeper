<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { session } from '../session.js';

const router = useRouter();
// Photo storage used, and the catalogues deleting the account would delete.
const account = ref(null);
onMounted(async () => {
  try {
    account.value = await api.get('/auth/me/account');
  } catch {
    /* the rest of the page still works */
  }
});
function size(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

const deleting = ref(false);
const deletePassword = ref('');
const deleteConfirm = ref('');
const deleteError = ref('');
const deleteBusy = ref(false);
async function deleteAccount() {
  deleteError.value = '';
  deleteBusy.value = true;
  try {
    await api.del('/auth/me', { password: deletePassword.value });
    session.user = null;
    router.replace({ name: 'home' });
  } catch (err) {
    deleteError.value = err.message;
  } finally {
    deleteBusy.value = false;
  }
}

const displayName = ref(session.user?.displayName ?? '');
const currentPassword = ref('');
const newPassword = ref('');
const message = ref('');
const error = ref('');

async function saveName() {
  message.value = error.value = '';
  try {
    const res = await api.patch('/auth/me', { displayName: displayName.value });
    session.user = res.user;
    message.value = 'Display name saved.';
  } catch (err) {
    error.value = err.message;
  }
}

async function changePassword() {
  message.value = error.value = '';
  try {
    await api.patch('/auth/me', { currentPassword: currentPassword.value, newPassword: newPassword.value });
    currentPassword.value = newPassword.value = '';
    message.value = 'Password changed. Other devices have been signed out.';
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <div class="page narrow">
    <h1>Your account</h1>
    <p class="soft">
      Signed in as {{ session.user?.email }}.
      <template v-if="session.user?.isSiteAdmin">
        You are a site admin: <RouterLink :to="{ name: 'admin' }">Site admin</RouterLink> (sign-ups, invites, storage, accounts).
      </template>
    </p>
    <div v-if="message" class="notice" role="status">{{ message }}</div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <form @submit.prevent="saveName">
      <h2>Display name</h2>
      <label class="field">
        <span class="visually-hidden">Display name</span>
        <input v-model="displayName" type="text" maxlength="80" required />
      </label>
      <button class="btn" type="submit">Save name</button>
    </form>

    <form class="block" @submit.prevent="changePassword">
      <h2>Change password</h2>
      <label class="field">
        <span>Current password</span>
        <input v-model="currentPassword" type="password" autocomplete="current-password" required />
      </label>
      <label class="field">
        <span>New password</span>
        <input v-model="newPassword" type="password" autocomplete="new-password" minlength="10" required />
        <span class="hint">At least 10 characters.</span>
      </label>
      <button class="btn" type="submit">Change password</button>
    </form>

    <section v-if="account" class="block">
      <h2>Photo storage</h2>
      <p>
        {{ size(account.storage.usedBytes) }} in {{ account.storage.photos }} photo{{ account.storage.photos === 1 ? '' : 's' }}<template
          v-if="account.storage.quotaMb"
        >
          of your {{ account.storage.quotaMb >= 1024 ? `${+(account.storage.quotaMb / 1024).toFixed(1)} GB` : `${account.storage.quotaMb} MB` }}</template
        >.
      </p>
      <div v-if="account.storage.quotaMb" class="meter" role="img" :aria-label="`${Math.round((account.storage.usedBytes / (account.storage.quotaMb * 1048576)) * 100)}% used`">
        <span :style="{ width: Math.min(100, (account.storage.usedBytes / (account.storage.quotaMb * 1048576)) * 100) + '%' }"></span>
      </div>
    </section>

    <section class="block danger-zone">
      <h2>Delete your account</h2>
      <p v-if="!deleting" class="soft">Remove your account from this site for good.</p>
      <button v-if="!deleting" class="btn quiet danger-text" type="button" @click="deleting = true">Delete account...</button>
      <form v-else @submit.prevent="deleteAccount">
        <div v-if="deleteError" class="notice error" role="alert">{{ deleteError }}</div>
        <p>You’ll be signed out and can’t sign in again. Sightings you logged in other people’s catalogues stay, without your name.</p>
        <template v-if="account?.ownedCatalogues.length">
          <p><strong>These catalogues you own will be deleted, with all their photos:</strong></p>
          <ul class="small">
            <li v-for="c in account.ownedCatalogues" :key="c.slug">
              {{ c.name }} <span class="soft">({{ c.sightings }} sightings, {{ c.photos }} photos<template v-if="c.otherMembers">, shared with {{ c.otherMembers }}</template>)</span>
            </li>
          </ul>
          <p class="soft small">
            To keep one, download it first (its Settings → Export), or pass it on to an editor (its Settings → Editors → Make owner).
          </p>
        </template>
        <label class="field">
          <span>Your password</span>
          <input v-model="deletePassword" type="password" autocomplete="current-password" required />
        </label>
        <label class="field">
          <span>Type <strong>delete</strong> to confirm</span>
          <input v-model="deleteConfirm" type="text" autocomplete="off" />
        </label>
        <div class="row">
          <button class="btn danger" type="submit" :disabled="deleteBusy || deleteConfirm.trim().toLowerCase() !== 'delete'">
            {{ deleteBusy ? 'Deleting...' : 'Delete my account' }}
          </button>
          <button class="btn quiet" type="button" @click="(deleting = false), (deleteError = '')">Cancel</button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.block {
  margin-top: 40px;
}
.meter {
  height: 8px;
  max-width: 420px;
  border-radius: 4px;
  background: var(--rule);
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: var(--jay);
}
.danger-text {
  color: var(--danger);
}
</style>
