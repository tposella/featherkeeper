<script setup>
import { defineAsyncComponent, ref } from 'vue';
import { useRouter } from 'vue-router';
import { session, signOut } from './session.js';

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
      <template v-if="session.user">
        <RouterLink to="/account" class="who">{{ session.user.displayName }}</RouterLink>
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
</template>

<style scoped>
main:focus {
  outline: none;
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
.who {
  color: var(--ink);
  font-weight: 700;
  text-decoration: none;
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
