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

loadSession()
  .catch(() => {
    // Server unreachable: still render so the user sees a message instead of a blank page.
    session.ready = true;
  })
  .finally(() => {
    createApp(App).use(router).mount('#app');
  });
