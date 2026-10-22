import { reactive } from 'vue';
import { api } from './api.js';

// App-wide state: who is signed in and the server's public settings.
export const session = reactive({
  ready: false,
  user: null,
  config: {
    allowRegistration: false,
    needsSetup: false,
    ebirdEnabled: false,
    identifyEnabled: false,
    maxUploadMb: 25,
    version: '',
  },
});

export async function loadSession() {
  const [me, config] = await Promise.all([api.get('/auth/me'), api.get('/config')]);
  session.user = me.user;
  session.config = config;
  session.ready = true;
}

export async function signOut() {
  await api.post('/auth/logout');
  session.user = null;
}
