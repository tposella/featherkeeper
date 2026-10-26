<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { loadSession, session } from '../session.js';

const props = defineProps({ mode: { type: String, required: true } });
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const displayName = ref('');
const error = ref('');
const busy = ref(false);

const isRegister = computed(() => props.mode === 'register');

// Invite links: /register?invite=...  Checked first so a used or expired link says so up front.
const invite = typeof route.query.invite === 'string' ? route.query.invite : '';
const inviteState = ref(invite ? 'checking' : 'none'); // none | checking | valid | used | expired | not_found
onMounted(async () => {
  if (!invite || !isRegister.value) return;
  try {
    const res = await api.get(`/auth/invite/${encodeURIComponent(invite)}`);
    inviteState.value = res.valid ? 'valid' : res.reason;
  } catch {
    inviteState.value = 'not_found';
  }
});
const canRegister = computed(() => session.config.allowRegistration || inviteState.value === 'valid' || inviteState.value === 'checking');
const title = computed(() => {
  if (isRegister.value) return session.config.needsSetup ? 'Create the admin account' : 'Create an account';
  return 'Sign in';
});

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (isRegister.value) {
      await api.post('/auth/register', {
        email: email.value,
        password: password.value,
        displayName: displayName.value,
        ...(invite ? { invite } : {}),
      });
    } else {
      await api.post('/auth/login', { email: email.value, password: password.value });
    }
    await loadSession();
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    router.replace(next);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page narrow">
    <h1>{{ title }}</h1>
    <div v-if="!isRegister && $route.query.expired" class="notice" role="status">
      You’ve been signed out (your sign-in ran out, or ended on another device). Sign in again to carry on where you were.
    </div>
    <p v-if="isRegister && session.config.needsSetup" class="soft">
      This is a new Featherkeeper site. The first account becomes the site admin.
    </p>
    <p v-if="isRegister && inviteState === 'valid'" class="notice" role="status">You’ve been invited. Create your account below.</p>
    <div v-if="isRegister && !canRegister" class="notice">
      <template v-if="inviteState === 'used'">That invite link has already been used.</template>
      <template v-else-if="inviteState === 'expired'">That invite link has expired.</template>
      <template v-else-if="inviteState === 'not_found'">That invite link isn’t valid.</template>
      <template v-else>Sign-ups on this site are by invitation.</template>
      Ask the site admin for a new invite link.
    </div>
    <form v-else @submit.prevent="submit">
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <label v-if="isRegister" class="field">
        <span>Display name</span>
        <input v-model="displayName" type="text" autocomplete="nickname" required maxlength="80" />
        <span class="hint">Shown on catalogues you own or edit.</span>
      </label>
      <label class="field">
        <span>Email</span>
        <input v-model="email" type="email" autocomplete="email" required />
      </label>
      <label class="field">
        <span>Password</span>
        <input
          v-model="password"
          type="password"
          :autocomplete="isRegister ? 'new-password' : 'current-password'"
          :minlength="isRegister ? 10 : undefined"
          required
        />
        <span v-if="isRegister" class="hint">At least 10 characters.</span>
      </label>
      <button class="btn primary" type="submit" :disabled="busy">
        {{ isRegister ? 'Create account' : 'Sign in' }}
      </button>
    </form>
    <p class="switch soft">
      <template v-if="isRegister">Already have an account? <RouterLink to="/login">Sign in</RouterLink></template>
      <template v-else-if="session.config.allowRegistration">
        New here? <RouterLink to="/register">Create an account</RouterLink>
      </template>
    </p>
  </div>
</template>

<style scoped>
.switch {
  margin-top: 24px;
}
</style>
