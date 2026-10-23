<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useCatalogue } from '../catalogue-context.js';
import EbirdImport from '../components/EbirdImport.vue';
import VisibilityPicker from '../components/VisibilityPicker.vue';
import { session } from '../session.js';

const { catalogue, species, reload, reloadDex } = useCatalogue();
const router = useRouter();
const canManage = computed(() => catalogue.value.access.canManage);
const canEdit = computed(() => catalogue.value.access.canEdit);

// ---- Details ---------------------------------------------------------------
const details = reactive({
  name: catalogue.value.name,
  slug: catalogue.value.slug,
  description: catalogue.value.description,
  regionCode: catalogue.value.regionCode ?? '',
  visibility: catalogue.value.visibility,
  hideLocations: catalogue.value.hideLocations,
  dexStyle: catalogue.value.dexStyle ?? 'slots',
});
const detailsMsg = ref('');
const detailsErr = ref('');

async function saveDetails() {
  detailsMsg.value = detailsErr.value = '';
  try {
    const { catalogue: updated } = await api.patch(`/catalogues/${catalogue.value.slug}`, {
      ...details,
      regionCode: details.regionCode || null,
    });
    if (updated.slug !== catalogue.value.slug) {
      router.replace({ name: 'settings', params: { slug: updated.slug } });
      return;
    }
    await reload();
    detailsMsg.value = 'Settings saved.';
  } catch (err) {
    detailsErr.value = err.message;
  }
}

// ---- eBird import ---------------------------------------------------------
const importMsg = ref('');
const importErr = ref('');
const importing = ref(false);
const importRound = ref(0); // remounts the panel after an import so its list is fresh

async function runImport(request) {
  importMsg.value = importErr.value = '';
  importing.value = true;
  try {
    const res = await api.post(`/catalogues/${catalogue.value.slug}/import/ebird`, request);
    importMsg.value = `Added ${res.added} species to the dex.`;
    importRound.value += 1;
    await Promise.all([reload(), reloadDex()]);
  } catch (err) {
    importErr.value = err.message;
  } finally {
    importing.value = false;
  }
}

// ---- Add species by hand --------------------------------------------------
const search = ref('');
const results = ref([]);
const manual = reactive({ commonName: '', scientificName: '', familyCommon: '' });
const addMsg = ref('');
const addErr = ref('');
const inDex = computed(() => new Set(species.value.map((s) => s.id)));
let searchTimer;

function onSearch() {
  clearTimeout(searchTimer);
  const q = search.value.trim();
  if (q.length < 2) {
    results.value = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      results.value = (await api.get(`/species?q=${encodeURIComponent(q)}`)).species;
    } catch (err) {
      addErr.value = err.message;
    }
  }, 250);
}

async function addSpecies(body) {
  addMsg.value = addErr.value = '';
  try {
    const res = await api.post(`/catalogues/${catalogue.value.slug}/species`, body);
    addMsg.value = res.added ? `Added ${res.entry.commonName}.` : `${res.entry.commonName} is already in the dex.`;
    await Promise.all([reload(), reloadDex()]);
    return true;
  } catch (err) {
    addErr.value = err.message;
    return false;
  }
}

async function addManual() {
  const ok = await addSpecies({
    commonName: manual.commonName,
    scientificName: manual.scientificName,
    ...(manual.familyCommon ? { familyCommon: manual.familyCommon } : {}),
  });
  if (ok) Object.assign(manual, { commonName: '', scientificName: '', familyCommon: '' });
}

// ---- Members ----------------------------------------------------------------
const members = ref([]);
const inviteEmail = ref('');
const memberErr = ref('');
const memberMsg = ref('');

async function loadMembers() {
  members.value = (await api.get(`/catalogues/${catalogue.value.slug}/members`)).members;
}
onMounted(() => {
  if (canEdit.value) loadMembers().catch((err) => (memberErr.value = err.message));
});

async function invite() {
  memberErr.value = memberMsg.value = '';
  try {
    await api.post(`/catalogues/${catalogue.value.slug}/members`, { email: inviteEmail.value });
    memberMsg.value = `${inviteEmail.value} can now edit this catalogue.`;
    inviteEmail.value = '';
    await loadMembers();
  } catch (err) {
    memberErr.value = err.message;
  }
}

async function removeMember(m) {
  const self = m.userId === session.user.id;
  const q = self ? 'Leave this catalogue? You will lose edit access.' : `Remove ${m.displayName} as an editor?`;
  if (!confirm(q)) return;
  memberErr.value = '';
  try {
    await api.del(`/catalogues/${catalogue.value.slug}/members/${m.userId}`);
    if (self) {
      router.push('/');
      return;
    }
    await loadMembers();
  } catch (err) {
    memberErr.value = err.message;
  }
}

async function makeOwner(m) {
  if (!confirm(`Make ${m.displayName} the owner? You will become an editor.`)) return;
  memberErr.value = '';
  try {
    await api.patch(`/catalogues/${catalogue.value.slug}/members/${m.userId}`, { role: 'owner' });
    await Promise.all([reload(), loadMembers()]);
  } catch (err) {
    memberErr.value = err.message;
  }
}

// ---- Delete -----------------------------------------------------------------
const confirmName = ref('');
const deleteErr = ref('');
async function deleteCatalogue() {
  deleteErr.value = '';
  try {
    await api.del(`/catalogues/${catalogue.value.slug}`);
    router.push('/');
  } catch (err) {
    deleteErr.value = err.message;
  }
}
</script>

<template>
  <div class="settings">
    <p v-if="!canEdit" class="notice">Only the owner and editors can change this catalogue.</p>

    <template v-else>
      <section v-if="canManage">
        <h2>Details</h2>
        <form @submit.prevent="saveDetails">
          <div v-if="detailsErr" class="notice error" role="alert">{{ detailsErr }}</div>
          <div v-if="detailsMsg" class="notice" role="status">{{ detailsMsg }}</div>
          <div class="row">
            <label class="field">
              <span>Name</span>
              <input v-model="details.name" type="text" maxlength="120" required />
            </label>
            <label class="field">
              <span>Web address</span>
              <input v-model="details.slug" type="text" maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
              <span class="hint">/c/{{ details.slug }}. Lowercase letters, numbers and dashes.</span>
            </label>
          </div>
          <label class="field">
            <span>Description</span>
            <textarea v-model="details.description" maxlength="4000"></textarea>
          </label>
          <label class="field">
            <span>eBird region code</span>
            <input v-model="details.regionCode" type="text" maxlength="20" placeholder="CA-AB" />
          </label>
          <VisibilityPicker v-model="details.visibility" />
          <label class="check">
            <input v-model="details.hideLocations" type="checkbox" />
            <span>
              <strong>Hide exact locations from viewers</strong>
              <span class="soft small">
                Viewers won't see map pins, coordinates or original photo files (which carry GPS). Use this for nest
                sites, sensitive species or your home.
              </span>
            </span>
          </label>
          <fieldset class="dex-style">
            <legend>Dex view</legend>
            <p class="soft small">
              How species you haven’t photographed yet look at first. Anyone can switch on the Dex tab, and their
              browser remembers their choice.
            </p>
            <label class="check">
              <input v-model="details.dexStyle" type="radio" value="slots" name="dex-style" />
              <span><strong>Empty slots</strong> <span class="soft small">An empty frame until you add a photo.</span></span>
            </label>
            <label class="check">
              <input v-model="details.dexStyle" type="radio" value="examples" name="dex-style" />
              <span>
                <strong>Greyed examples</strong>
                <span class="soft small">
                  A greyed-out example photo from iNaturalist, replaced by your own photo in full colour once you have one.
                </span>
              </span>
            </label>
          </fieldset>
          <button class="btn primary" type="submit">Save settings</button>
        </form>
      </section>

      <section id="species">
        <h2>Species</h2>
        <p class="soft">The dex has {{ species.length }} species.</p>

        <div class="sub">
          <h3>Import from eBird</h3>
          <p v-if="!session.config.ebirdEnabled" class="soft">
            eBird import is switched off on this site. The site admin can turn it on by setting EBIRD_API_KEY.
          </p>
          <template v-else>
            <div v-if="importErr" class="notice error" role="alert">{{ importErr }}</div>
            <div v-if="importMsg" class="notice" role="status">{{ importMsg }}</div>
            <EbirdImport
              :key="importRound"
              :catalogue="catalogue.slug"
              :initial-area="catalogue.area"
              :initial-region="catalogue.regionCode ?? ''"
              :busy="importing"
              :submit-label="(n) => `Add ${n} species`"
              @submit="runImport"
            />
          </template>
        </div>

        <div class="sub">
          <h3>Add a species by hand</h3>
          <div v-if="addErr" class="notice error" role="alert">{{ addErr }}</div>
          <div v-if="addMsg" class="notice" role="status">{{ addMsg }}</div>
          <label class="field">
            <span>Search species already on this site</span>
            <input v-model="search" type="search" placeholder="Name or scientific name" @input="onSearch" />
          </label>
          <ul v-if="results.length" class="results">
            <li v-for="r in results" :key="r.id">
              <span>
                {{ r.commonName }} <span class="sci soft small">{{ r.scientificName }}</span>
              </span>
              <span v-if="inDex.has(r.id)" class="soft small">In the dex</span>
              <button v-else class="btn quiet" type="button" @click="addSpecies({ speciesId: r.id })">Add</button>
            </li>
          </ul>
          <form class="manual" @submit.prevent="addManual">
            <p class="soft small">Not listed? Enter it yourself.</p>
            <div class="row">
              <label class="field">
                <span>Common name</span>
                <input v-model="manual.commonName" type="text" maxlength="200" required />
              </label>
              <label class="field">
                <span>Scientific name</span>
                <input v-model="manual.scientificName" type="text" maxlength="200" required />
              </label>
              <label class="field">
                <span>Family (optional)</span>
                <input v-model="manual.familyCommon" type="text" maxlength="200" />
              </label>
            </div>
            <button class="btn" type="submit">Add species</button>
          </form>
        </div>
      </section>

      <section>
        <h2>Editors</h2>
        <p class="soft">Editors can add species, log sightings and upload photos. Only the owner can change settings.</p>
        <div v-if="memberErr" class="notice error" role="alert">{{ memberErr }}</div>
        <div v-if="memberMsg" class="notice" role="status">{{ memberMsg }}</div>
        <ul class="members">
          <li v-for="m in members" :key="m.userId">
            <span>
              <strong>{{ m.displayName }}</strong>
              <span v-if="m.email" class="soft small"> {{ m.email }}</span>
            </span>
            <span class="soft small">{{ m.role === 'owner' ? 'Owner' : 'Editor' }}</span>
            <span class="row actions">
              <button v-if="canManage && m.role !== 'owner'" class="btn quiet" type="button" @click="makeOwner(m)">
                Make owner
              </button>
              <button
                v-if="m.role !== 'owner' && (canManage || m.userId === session.user.id)"
                class="btn quiet danger-text"
                type="button"
                @click="removeMember(m)"
              >
                {{ m.userId === session.user.id ? 'Leave' : 'Remove' }}
              </button>
            </span>
          </li>
        </ul>
        <form v-if="canManage" class="row invite" @submit.prevent="invite">
          <label class="field">
            <span>Add an editor by email</span>
            <input v-model="inviteEmail" type="email" required placeholder="friend@example.com" />
            <span class="hint">They need an account on this site first.</span>
          </label>
          <button class="btn" type="submit">Add editor</button>
        </form>
      </section>

      <section v-if="canManage" class="danger-zone">
        <h2>Delete catalogue</h2>
        <p>Deletes every sighting and photo in it. This cannot be undone.</p>
        <div v-if="deleteErr" class="notice error" role="alert">{{ deleteErr }}</div>
        <form class="row" @submit.prevent="deleteCatalogue">
          <label class="field">
            <span>Type <strong>{{ catalogue.name }}</strong> to confirm</span>
            <input v-model="confirmName" type="text" autocomplete="off" />
          </label>
          <button class="btn danger" type="submit" :disabled="confirmName !== catalogue.name">Delete catalogue</button>
        </form>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings {
  max-width: 820px;
}
section {
  margin-bottom: 48px;
}
.sub {
  border-top: 1px solid var(--rule);
  padding-top: 16px;
  margin-top: 16px;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 20px;
}
.check input {
  margin-top: 5px;
}
.check > span {
  display: grid;
}
.row > .btn {
  margin-top: 8px;
}
.results,
.members {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
}
.results li,
.members li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--rule);
}
.members li > span:first-child {
  flex: 1;
}
.actions {
  gap: 0;
}
.manual {
  margin-top: 16px;
}
.invite {
  align-items: flex-end;
}
.danger-text {
  color: var(--danger);
}
.danger-zone {
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  padding: 16px 20px;
}
.danger-zone .row {
  align-items: flex-end;
}
.dex-style {
  border: 0;
  padding: 0;
  margin: 16px 0;
}
.dex-style legend {
  font-weight: 700;
  padding: 0;
}
.dex-style p {
  margin: 2px 0 8px;
}
</style>
