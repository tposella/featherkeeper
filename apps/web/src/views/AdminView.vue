<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { formatDate } from '../format.js';
import { session } from '../session.js';

// Site admin: sign-ups and invites, storage, species names, and every account.
const users = ref([]);
const site = ref(null); // { registration, defaultQuotaMb, disk, taxonomy }
const invites = ref([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');

async function load() {
  try {
    const [u, s, i] = await Promise.all([api.get('/admin/users'), api.get('/admin/settings'), api.get('/admin/invites')]);
    users.value = u.users;
    site.value = s;
    invites.value = i.invites;
    quotaDraft.value = s.defaultQuotaMb ? String(s.defaultQuotaMb / 1024) : '';
  } catch (err) {
    error.value = err.status === 403 ? 'Only a site admin can see this page.' : err.message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const admins = computed(() => users.value.filter((u) => u.isSiteAdmin).length);

function size(bytes) {
  if (!bytes) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
const gb = (mb) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

// ---- Sign-ups ------------------------------------------------------------------
async function setRegistration(mode) {
  error.value = notice.value = '';
  try {
    await api.patch('/admin/settings', { registration: mode });
    site.value.registration = mode;
    session.config.registration = mode;
    session.config.allowRegistration = mode === 'open';
    notice.value = mode === 'open' ? 'Anyone can now create an account.' : 'Sign-ups are now by invite link only.';
  } catch (err) {
    error.value = err.message;
  }
}

const inviteNote = ref('');
const inviteDays = ref(7);
const newInvite = ref(null); // { url, expiresAt } shown once
const copied = ref('');
async function createInvite() {
  error.value = '';
  try {
    newInvite.value = await api.post('/admin/invites', { note: inviteNote.value, days: Number(inviteDays.value) });
    inviteNote.value = '';
    invites.value = (await api.get('/admin/invites')).invites;
  } catch (err) {
    error.value = err.message;
  }
}
async function revokeInvite(inv) {
  if (!confirm('Cancel this invite link? It will stop working.')) return;
  await api.del(`/admin/invites/${inv.id}`);
  invites.value = invites.value.filter((i) => i.id !== inv.id);
}
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = what;
    setTimeout(() => (copied.value = ''), 2000);
  } catch {
    /* the text is selectable */
  }
}

// ---- Storage --------------------------------------------------------------------
const quotaDraft = ref(''); // GB, empty = no limit
async function saveDefaultQuota() {
  error.value = notice.value = '';
  const gbValue = quotaDraft.value === '' ? 0 : Number(quotaDraft.value);
  if (!Number.isFinite(gbValue) || gbValue < 0) {
    error.value = 'Enter a number of GB, or leave it empty for no limit.';
    return;
  }
  try {
    const mb = Math.round(gbValue * 1024);
    await api.patch('/admin/settings', { defaultQuotaMb: mb });
    site.value.defaultQuotaMb = mb;
    users.value = (await api.get('/admin/users')).users;
    notice.value = mb ? `Each account can now store up to ${gb(mb)} of photos (unless set below).` : 'No storage limit by default.';
  } catch (err) {
    error.value = err.message;
  }
}
const diskUse = computed(() => {
  const d = site.value?.disk;
  if (!d?.totalBytes) return null;
  const used = d.totalBytes - d.freeBytes;
  return { pct: Math.round((used / d.totalBytes) * 100), photosPct: Math.round((d.photosBytes / d.totalBytes) * 100), ...d };
});

async function setUserQuota(u) {
  const current = u.quotaMb === null ? '' : String(u.quotaMb / 1024);
  const answer = prompt(
    `Photo storage limit for ${u.displayName}, in GB.\nLeave empty to use the site default${site.value.defaultQuotaMb ? ` (${gb(site.value.defaultQuotaMb)})` : ' (no limit)'}; 0 means no limit.`,
    current,
  );
  if (answer === null) return;
  const value = answer.trim() === '' ? null : Math.round(Number(answer) * 1024);
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    error.value = 'Enter a number of GB.';
    return;
  }
  try {
    await api.patch(`/admin/users/${u.id}`, { quotaMb: value });
    users.value = (await api.get('/admin/users')).users;
  } catch (err) {
    error.value = err.message;
  }
}

// ---- Species names -----------------------------------------------------------
const refreshing = ref(false);
async function refreshTaxonomy() {
  refreshing.value = true;
  error.value = '';
  try {
    const report = await api.post('/admin/taxonomy/refresh');
    site.value.taxonomy.last = report;
  } catch (err) {
    error.value = err.message;
  } finally {
    refreshing.value = false;
  }
}

// ---- Users ------------------------------------------------------------------------
const resetting = ref(null); // { user, mode, password, busy, error, result }
const resetDialog = ref(null);
async function startReset(user) {
  resetting.value = { user, mode: 'generate', password: '', busy: false, error: '', result: null };
  await nextTick();
  resetDialog.value?.querySelector('input')?.focus();
}
async function doReset() {
  const r = resetting.value;
  r.busy = true;
  r.error = '';
  try {
    r.result = await api.post(`/admin/users/${r.user.id}/reset-password`, r.mode === 'type' ? { password: r.password } : {});
  } catch (err) {
    r.error = err.message;
  } finally {
    r.busy = false;
  }
}

async function setAdmin(user, value) {
  if (!confirm(`${value ? 'Make' : 'Remove'} ${user.displayName} ${value ? 'a site admin' : 'as a site admin'}?`)) return;
  error.value = '';
  try {
    await api.patch(`/admin/users/${user.id}`, { isSiteAdmin: value });
    user.isSiteAdmin = value;
  } catch (err) {
    error.value = err.message;
  }
}

const deleting = ref(null); // { user, catalogues, confirmText, busy, error }
async function startDelete(user) {
  error.value = '';
  try {
    const { catalogues } = await api.get(`/admin/users/${user.id}/owned`);
    deleting.value = { user, catalogues, confirmText: '', busy: false, error: '' };
  } catch (err) {
    error.value = err.message;
  }
}
async function doDelete() {
  const d = deleting.value;
  d.busy = true;
  d.error = '';
  try {
    await api.del(`/admin/users/${d.user.id}`);
    users.value = users.value.filter((u) => u.id !== d.user.id);
    notice.value = `${d.user.displayName}’s account was deleted.`;
    deleting.value = null;
  } catch (err) {
    d.error = err.message;
  } finally {
    d.busy = false;
  }
}
</script>

<template>
  <div class="page">
    <h1>Site admin</h1>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <p v-if="loading" class="soft">Loading...</p>

    <template v-if="site">
      <section class="block">
        <h2>Who can sign up</h2>
        <div class="seg" role="radiogroup" aria-label="Who can create an account">
          <button
            type="button"
            role="radio"
            :aria-checked="site.registration === 'invite'"
            :class="{ on: site.registration === 'invite' }"
            @click="setRegistration('invite')"
          >
            Invite only
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="site.registration === 'open'"
            :class="{ on: site.registration === 'open' }"
            @click="setRegistration('open')"
          >
            Anyone
          </button>
        </div>
        <p class="soft small">
          <template v-if="site.registration === 'invite'">
            Only people with an invite link from you can create an account. Recommended for a public site.
          </template>
          <template v-else>Anyone who can reach the site can create an account and upload photos.</template>
        </p>

        <h3>Invite someone</h3>
        <form class="row invite-form" @submit.prevent="createInvite">
          <label class="field grow">
            <span>Note <span class="soft">(for you, e.g. their name)</span></span>
            <input v-model="inviteNote" type="text" maxlength="200" placeholder="Sam from the birding club" />
          </label>
          <label class="field">
            <span>Link works for</span>
            <select v-model="inviteDays">
              <option :value="1">1 day</option>
              <option :value="7">7 days</option>
              <option :value="30">30 days</option>
            </select>
          </label>
          <button class="btn primary" type="submit">Make invite link</button>
        </form>
        <div v-if="newInvite" class="new-invite" role="status">
          <p class="small"><strong>Send this link to them.</strong> It works once, until {{ formatDate(newInvite.expiresAt) }}, and won’t be shown again.</p>
          <p class="link"><code>{{ newInvite.url }}</code></p>
          <div class="row">
            <button class="btn" type="button" @click="copy(newInvite.url, 'invite')">{{ copied === 'invite' ? 'Copied' : 'Copy link' }}</button>
            <button class="btn quiet" type="button" @click="newInvite = null">Done</button>
          </div>
        </div>
        <ul v-if="invites.length" class="invites">
          <li v-for="inv in invites" :key="inv.id">
            <span>
              <strong>{{ inv.note || 'Invite' }}</strong>
              <span class="soft small">
                <template v-if="inv.usedAt"> · used by {{ inv.usedBy }} on {{ formatDate(inv.usedAt) }}</template>
                <template v-else-if="inv.expired"> · expired {{ formatDate(inv.expiresAt) }}</template>
                <template v-else> · waiting, works until {{ formatDate(inv.expiresAt) }}</template>
              </span>
            </span>
            <button v-if="!inv.usedAt && !inv.expired" class="btn quiet" type="button" @click="revokeInvite(inv)">Cancel</button>
          </li>
        </ul>
      </section>

      <section class="block">
        <h2>Storage</h2>
        <template v-if="diskUse">
          <div class="disk" role="img" :aria-label="`Disk ${diskUse.pct}% full; photos use ${size(diskUse.photosBytes)}`">
            <span class="other" :style="{ width: diskUse.pct + '%' }"></span>
            <span class="photos" :style="{ width: diskUse.photosPct + '%' }"></span>
          </div>
          <p class="small">
            <strong>{{ size(diskUse.freeBytes) }} free</strong> of {{ size(diskUse.totalBytes) }} on the photo disk.
            Photos use {{ size(diskUse.photosBytes) }} ({{ diskUse.photos }} photo{{ diskUse.photos === 1 ? '' : 's' }}).
          </p>
        </template>
        <form class="row" @submit.prevent="saveDefaultQuota">
          <label class="field">
            <span>Photo storage per account (GB)</span>
            <input v-model="quotaDraft" type="number" min="0" step="0.5" placeholder="No limit" />
            <span class="hint">Empty or 0 means no limit. You can set a different limit for one person below.</span>
          </label>
          <button class="btn" type="submit">Save</button>
        </form>
      </section>

      <section class="block">
        <h2>Species names</h2>
        <p class="soft small">
          eBird updates its taxonomy every year (renames, splits and lumps). Featherkeeper checks about once a month
          and updates names and field-guide order.
        </p>
        <template v-if="site.taxonomy.last">
          <p class="small">
            Last checked {{ formatDate(site.taxonomy.last.refreshedAt, true) }}: {{ site.taxonomy.last.checked }} species,
            {{ site.taxonomy.last.updated.length }} updated<template v-if="site.taxonomy.last.renamed">
              ({{ site.taxonomy.last.renamed }} renamed)</template
            >.
          </p>
          <ul v-if="site.taxonomy.last.updated.some((u) => u.renamed)" class="small changes">
            <li v-for="u in site.taxonomy.last.updated.filter((x) => x.renamed).slice(0, 20)" :key="u.ebirdCode">
              {{ u.from }} → <strong>{{ u.to }}</strong>
            </li>
          </ul>
          <div v-if="site.taxonomy.last.notFound.length" class="notice small">
            <strong>To review:</strong> eBird no longer lists these, usually because the species was split or merged.
            Check them, then move their sightings to the right species (Edit on a sighting).
            <ul>
              <li v-for="n in site.taxonomy.last.notFound" :key="n.ebirdCode">
                {{ n.commonName }} <span class="soft">({{ n.scientificName }}, in {{ n.catalogues }} catalogue{{ n.catalogues === 1 ? '' : 's' }})</span>
              </li>
            </ul>
          </div>
        </template>
        <p v-else class="soft small">Not checked yet.</p>
        <button v-if="site.taxonomy.ebirdEnabled" class="btn" type="button" :disabled="refreshing" @click="refreshTaxonomy">
          {{ refreshing ? 'Checking eBird...' : 'Check now' }}
        </button>
        <p v-else class="soft small">Needs an eBird API key (EBIRD_API_KEY).</p>
      </section>
    </template>

    <section v-if="users.length" class="block">
      <h2>Accounts</h2>
      <ul class="users">
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
            <span class="soft small">
              {{ size(u.usedBytes) }} in {{ u.photos }} photo{{ u.photos === 1 ? '' : 's' }}
              <template v-if="u.effectiveQuotaMb"> of {{ gb(u.effectiveQuotaMb) }}<template v-if="u.quotaMb === null"> (site default)</template></template>
              <template v-else> · no limit</template>
            </span>
          </div>
          <div class="row actions">
            <button class="btn" type="button" @click="startReset(u)">Reset password</button>
            <button class="btn quiet" type="button" @click="setUserQuota(u)">Storage limit</button>
            <button v-if="!u.isSiteAdmin" class="btn quiet" type="button" @click="setAdmin(u, true)">Make admin</button>
            <button v-else-if="admins > 1" class="btn quiet" type="button" @click="setAdmin(u, false)">Remove admin</button>
            <button v-if="u.id !== session.user?.id" class="btn quiet danger-text" type="button" @click="startDelete(u)">Delete</button>
          </div>
        </li>
      </ul>

      <details class="console">
        <summary>Locked out of the admin account?</summary>
        <p class="small">Run this on the server, in the folder with docker-compose.yml:</p>
        <pre><code>docker compose exec api node src/admin-cli.js reset-password you@example.com</code></pre>
        <p class="small soft">It prints a temporary password and signs that account out everywhere. <code>list-users</code> shows every account.</p>
      </details>
    </section>

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
              <button class="btn" type="button" @click="copy(resetting.result.password, 'password')">
                {{ copied === 'password' ? 'Copied' : 'Copy' }}
              </button>
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
            <button class="btn primary" type="submit" :disabled="resetting.busy">{{ resetting.busy ? 'Resetting...' : 'Reset password' }}</button>
            <button class="btn quiet" type="button" @click="resetting = null">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="deleting" class="overlay" @click.self="deleting = null" @keydown.esc="deleting = null">
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">Delete {{ deleting.user.displayName }}’s account?</h2>
        <div v-if="deleting.error" class="notice error" role="alert">{{ deleting.error }}</div>
        <p>They’ll be signed out and can’t sign in again. Sightings they logged in other people’s catalogues stay.</p>
        <template v-if="deleting.catalogues.length">
          <p><strong>These catalogues they own will be deleted, with all their photos:</strong></p>
          <ul class="small">
            <li v-for="c in deleting.catalogues" :key="c.slug">
              {{ c.name }} <span class="soft">({{ c.sightings }} sightings, {{ c.photos }} photos<template v-if="c.otherMembers">, shared with {{ c.otherMembers }}</template>)</span>
            </li>
          </ul>
          <p class="soft small">To keep one, its owner can pass it on to someone else first (catalogue Settings → Editors).</p>
        </template>
        <form @submit.prevent="doDelete">
          <label class="field">
            <span>Type <strong>delete</strong> to confirm</span>
            <input v-model="deleting.confirmText" type="text" autocomplete="off" />
          </label>
          <div class="row">
            <button class="btn danger" type="submit" :disabled="deleting.busy || deleting.confirmText.trim().toLowerCase() !== 'delete'">
              {{ deleting.busy ? 'Deleting...' : 'Delete account' }}
            </button>
            <button class="btn quiet" type="button" @click="deleting = null">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block {
  margin: 0 0 36px;
}
.block h3 {
  margin: 20px 0 8px;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 6px;
}
.seg button {
  font: inherit;
  font-weight: 700;
  border: 0;
  border-right: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-soft);
  padding: 8px 16px;
  min-height: 40px;
  cursor: pointer;
}
.seg button:last-child {
  border-right: 0;
}
.seg button.on {
  background: var(--ink);
  color: var(--paper);
}
.invite-form {
  align-items: flex-end;
}
.grow {
  flex: 1 1 260px;
}
.new-invite {
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--jay-wash);
}
.new-invite p {
  margin: 0 0 8px;
}
.link code {
  display: block;
  overflow-wrap: anywhere;
  user-select: all;
}
.invites,
.changes {
  list-style: none;
  padding: 0;
  margin: 12px 0;
  display: grid;
  gap: 6px;
}
.invites li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
}
.disk {
  display: flex;
  height: 10px;
  border-radius: 5px;
  background: var(--rule);
  overflow: hidden;
  position: relative;
  max-width: 520px;
}
.disk .other {
  background: var(--ink-soft);
  opacity: 0.45;
}
.disk .photos {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--jay);
}
.users {
  list-style: none;
  padding: 0;
  margin: 12px 0 20px;
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
.who > .soft {
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
.danger-text {
  color: var(--danger);
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
  width: min(560px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
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
    max-height: 90vh;
    border-radius: 14px 14px 0 0;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }
  .actions {
    width: 100%;
  }
}
</style>
