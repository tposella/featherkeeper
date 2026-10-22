<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';

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
      <template v-if="session.user?.isSiteAdmin">You are the site admin.</template>
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
  </div>
</template>

<style scoped>
.block {
  margin-top: 40px;
}
</style>
