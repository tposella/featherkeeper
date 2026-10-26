import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';

import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { loadSession, session } from './session.js';
import { onUnauthorized } from './api.js';

// The sign-in ran out (or ended on another device) while this page was open: show the sign-in page,
// and come back here afterwards.
onUnauthorized(() => {
  if (!session.user) return;
  session.user = null;
  const here = router.currentRoute.value;
  if (here.name !== 'login') router.push({ name: 'login', query: { next: here.fullPath, expired: '1' } });
});

loadSession()
  .catch(() => {
    // Server unreachable: still render so the user sees a message instead of a blank page.
    session.ready = true;
  })
  .finally(() => {
    createApp(App).use(router).mount('#app');
  });
