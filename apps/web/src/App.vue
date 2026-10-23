<script setup>
import { defineAsyncComponent, ref } from 'vue';
import { useRouter } from 'vue-router';
import { session, signOut } from './session.js';
import { theme, toggleTheme } from './theme.js';

const router = useRouter();
const DEMO = import.meta.env.VITE_DEMO === 'true';
const DemoBanner = DEMO ? defineAsyncComponent(() => import('./demo/DemoBanner.vue')) : null;
const iconUrl = `${import.meta.env.BASE_URL}favicon.svg`;
// Bumped when the demo switches viewer, so every page reloads its data.
const viewKey = ref(0);
const main = ref(null);
const skipToContent = () => main.value?.focus();

async function onSignOut() {
  await signOut();
  router.push({ name: 'home' });
}
</script>

<template>
  <a class="skip" href="#main" @click.prevent="skipToContent">Skip to content</a>
  <component :is="DemoBanner" v-if="DEMO" @switched="viewKey++" />
  <header class="topbar">
    <RouterLink to="/" class="brand">
      <img :src="iconUrl" alt="" width="28" height="28" />
      <span>Featherkeeper</span>
    </RouterLink>
    <nav class="topnav" aria-label="Account">
      <button
        type="button"
        class="theme-toggle"
        role="switch"
        :aria-checked="theme === 'dark'"
        :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="toggleTheme"
      >
        <span class="visually-hidden">Dark mode</span>
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
          </g>
        </svg>
      </button>
      <template v-if="session.user">
        <RouterLink to="/account" class="who" :aria-label="`Account: ${session.user.displayName}`">
          <span class="who-initial" aria-hidden="true">{{ (session.user.displayName || '?').trim().charAt(0).toUpperCase() }}</span>
          <span class="who-name">{{ session.user.displayName }}</span>
        </RouterLink>
        <button class="btn quiet" type="button" @click="onSignOut">Sign out</button>
      </template>
      <template v-else>
        <RouterLink to="/login" class="btn quiet">Sign in</RouterLink>
        <RouterLink v-if="session.config.allowRegistration" to="/register" class="btn">Create account</RouterLink>
      </template>
    </nav>
  </header>
  <main id="main" ref="main" tabindex="-1">
    <RouterView :key="viewKey" />
  </main>
  <footer class="credits small">
    <p>
      Species lists and sightings from <a href="https://ebird.org" target="_blank" rel="noopener">eBird.org</a>
      (Cornell Lab of Ornithology). Photos, sounds and seasonal counts from
      <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a><template
        v-if="session.config.soundsEnabled !== false"
      > and <a href="https://xeno-canto.org" target="_blank" rel="noopener">xeno-canto</a></template>, each credited
      where shown. Habitat text from <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>
      (CC BY-SA). Maps and place search ©
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>.
    </p>
    <p>
      <a href="https://github.com/tposella/featherkeeper" target="_blank" rel="noopener">Featherkeeper</a>
      {{ session.config.version ? ` ${session.config.version}` : '' }} is free software under the
      AGPL-3.0. See the
      <a href="https://github.com/tposella/featherkeeper#credits-and-sources" target="_blank" rel="noopener">full credits</a>.
    </p>
  </footer>
</template>

<style scoped>
main:focus {
  outline: none;
}
.credits {
  border-top: 1px solid var(--rule);
  padding: 16px var(--gutter) 28px;
  color: var(--ink-soft);
  max-width: 1200px;
  margin: 0 auto;
}
.credits p {
  margin: 0 0 6px;
  max-width: 110ch;
}
.credits a {
  color: inherit;
}
.skip {
  position: absolute;
  left: -9999px;
}
.skip:focus {
  left: 12px;
  top: 12px;
  z-index: 10;
  background: var(--paper-raised);
  padding: 8px 12px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px var(--gutter);
  border-bottom: 1px solid var(--rule);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--step-1);
  color: var(--ink);
  text-decoration: none;
}
.topnav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.theme-toggle {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink);
  cursor: pointer;
  flex: none;
}
.theme-toggle:hover {
  border-color: var(--jay);
  color: var(--jay);
}
.theme-toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.who {
  color: var(--ink);
  font-weight: 700;
  text-decoration: none;
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.who-initial {
  display: none;
}
.topnav .btn {
  white-space: nowrap;
}
/* Phones: a smaller header, and your initial instead of your full name. */
@media (max-width: 640px) {
  .topbar {
    gap: 8px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .brand {
    font-size: var(--step-0);
    gap: 8px;
    min-width: 0;
  }
  .brand span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topnav {
    gap: 6px;
    flex: none;
  }
  .who {
    max-width: none;
  }
  .who-name {
    display: none;
  }
  .who-initial {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--jay-wash);
    color: var(--jay);
  }
  .topnav .btn {
    padding-left: 0.7em;
    padding-right: 0.7em;
  }
}
</style>
