<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { formatDate } from '../format.js';
import { session } from '../session.js';

// Site admin: everyone with an account, password resets, and who else is an admin.
const users = ref([]);
const loading = ref(true);
const error = ref('');
const resetting = ref(null); // { user, mode: 'generate' | 'type', password, busy, error, result }
const resetDialog = ref(null);

async function load() {
  try {
    users.value = (await api.get('/admin/users')).users;
  } catch (err) {
    error.value = err.status === 403 ? 'Only a site admin can see this page.' : err.message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const admins = computed(() => users.value.filter((u) => u.isSiteAdmin).length);

async function startReset(user) {
  resetting.value = { user, mode: 'generate', password: '', busy: false, error: '', result: null, copied: false };
  await nextTick();
  resetDialog.value?.querySelector('input')?.focus();
}

async function doReset() {
  const r = resetting.value;
  r.busy = true;
  r.error = '';
  try {
    const body = r.mode === 'type' ? { password: r.password } : {};
    r.result = await api.post(`/admin/users/${r.user.id}/reset-password`, body);
  } catch (err) {
    r.error = err.message;
  } finally {
    r.busy = false;
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(resetting.value.result.password);
    resetting.value.copied = true;
  } catch {
    /* the password is selectable on screen */
  }
}

async function setAdmin(user, value) {
  const verb = value ? 'Make' : 'Remove';
  if (!confirm(`${verb} ${user.displayName} ${value ? 'a site admin' : 'as a site admin'}?`)) return;
  error.value = '';
  try {
    await api.patch(`/admin/users/${user.id}`, { isSiteAdmin: value });
    user.isSiteAdmin = value;
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <div class="page">
    <h1>Users</h1>
    <p class="soft">
      Everyone with an account on this site. There’s no email here, so if someone forgets their password, reset it
      and pass the new one on to them privately. They can change it under Account.
    </p>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <p v-if="loading" class="soft">Loading...</p>

    <ul v-if="users.length" class="users">
      <li v-for="u in users" :key="u.id">
        <div class="who">
          <strong>{{ u.displayName }}</strong>
          <span v-if="u.isSiteAdmin" class="chip small">Site admin</span>
          <span v-if="u.id === session.user?.id" class="chip small quiet">You</span>
          <span class="soft small email">{{ u.email }}</span>
          <span class="soft small">
            Joined {{ formatDate(u.createdAt) }} · {{ u.catalogues }} catalogue{{ u.catalogues === 1 ? '' : 's' }}
            <template v-if="u.lastSignIn"> · last signed in {{ formatDate(u.lastSignIn) }}</template>
          </span>
        </div>
        <div class="row actions">
          <button class="btn" type="button" @click="startReset(u)">Reset password</button>
          <button v-if="!u.isSiteAdmin" class="btn quiet" type="button" @click="setAdmin(u, true)">Make admin</button>
          <button
            v-else-if="admins > 1"
            class="btn quiet"
            type="button"
            @click="setAdmin(u, false)"
          >
            Remove admin
          </button>
        </div>
      </li>
    </ul>

    <details class="console">
      <summary>Locked out of the admin account?</summary>
      <p class="small">Run this on the server, in the folder with docker-compose.yml:</p>
      <pre><code>docker compose exec api node src/admin-cli.js reset-password you@example.com</code></pre>
      <p class="small soft">It prints a temporary password and signs that account out everywhere. <code>list-users</code> shows every account.</p>
    </details>

    <div v-if="resetting" class="overlay" @click.self="resetting = null" @keydown.esc="resetting = null">
      <div ref="resetDialog" class="panel" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <h2 id="reset-title">Reset password for {{ resetting.user.displayName }}</h2>

        <template v-if="resetting.result">
          <template v-if="resetting.result.generated">
            <p>The new password for <strong>{{ resetting.result.email }}</strong> is:</p>
            <p class="temp"><code>{{ resetting.result.password }}</code></p>
            <p class="soft small">
              It won’t be shown again. Pass it on privately; they can change it under Account after signing in. They’ve been
              signed out everywhere.
            </p>
            <div class="row">
              <button class="btn" type="button" @click="copy">{{ resetting.copied ? 'Copied' : 'Copy' }}</button>
              <button class="btn primary" type="button" @click="resetting = null">Done</button>
            </div>
          </template>
          <template v-else>
            <p>Password changed for <strong>{{ resetting.result.email }}</strong>. They’ve been signed out everywhere.</p>
            <button class="btn primary" type="button" @click="resetting = null">Done</button>
          </template>
        </template>

        <form v-else @submit.prevent="doReset">
          <div v-if="resetting.error" class="notice error" role="alert">{{ resetting.error }}</div>
          <label class="check">
            <input v-model="resetting.mode" type="radio" value="generate" name="reset-mode" />
            <span><strong>Make a temporary password</strong> <span class="soft small">Shown once, for you to pass on.</span></span>
          </label>
          <label class="check">
            <input v-model="resetting.mode" type="radio" value="type" name="reset-mode" />
            <span><strong>Set one myself</strong></span>
          </label>
          <label v-if="resetting.mode === 'type'" class="field">
            <span>New password</span>
            <input v-model="resetting.password" type="text" autocomplete="off" minlength="10" maxlength="200" required />
            <span class="hint">At least 10 characters.</span>
          </label>
          <div class="row">
            <button class="btn primary" type="submit" :disabled="resetting.busy">
              {{ resetting.busy ? 'Resetting...' : 'Reset password' }}
            </button>
            <button class="btn quiet" type="button" @click="resetting = null">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.users {
  list-style: none;
  padding: 0;
  margin: 20px 0;
  display: grid;
  gap: 10px;
}
.users li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
}
.who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
}
.who .email,
.who .soft:last-child {
  flex-basis: 100%;
}
.email {
  overflow-wrap: anywhere;
}
.chip {
  border-radius: 999px;
  padding: 0 8px;
  background: var(--jay);
  color: var(--paper);
  font-weight: 700;
}
.chip.quiet {
  background: var(--jay-wash);
  color: var(--ink);
}
.actions {
  gap: 6px 8px;
}
.console {
  margin-top: 28px;
}
.console summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--jay);
}
pre {
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
}
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(10 14 12 / 0.6);
  display: grid;
  place-items: center;
  padding: 16px;
}
.panel {
  width: min(520px, 100%);
  background: var(--paper);
  border-radius: var(--radius);
  padding: 18px 22px 20px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
}
.panel h2 {
  margin-top: 0;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 8px 0;
}
.check input {
  margin-top: 5px;
}
.temp code {
  display: inline-block;
  font-size: var(--step-1);
  padding: 8px 14px;
  border-radius: var(--radius);
  background: var(--jay-wash);
  user-select: all;
  letter-spacing: 0.03em;
}
@media (max-width: 640px) {
  .overlay {
    padding: 0;
    place-items: end stretch;
  }
  .panel {
    width: 100%;
    border-radius: 14px 14px 0 0;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }
  .actions {
    width: 100%;
  }
}
</style>
