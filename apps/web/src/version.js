import { reactive } from 'vue';
import { api } from './api.js';

/**
 * The running version and, for site admins, whether a newer release is out (the API checks
 * GitHub every few hours). Shared by every version badge on the page.
 */
export const versionInfo = reactive({ loaded: false, current: '', admin: false, latest: null, updateAvailable: false, checkedAt: null, error: null, releasesUrl: '' });

let timer = null;
export async function loadVersion({ refresh = false } = {}) {
  try {
    const res = await api.get(`/version${refresh ? '?refresh=1' : ''}`);
    Object.assign(versionInfo, { latest: null, updateAvailable: false, error: null }, res, { loaded: true });
  } catch {
    versionInfo.loaded = true;
  }
  // Check back hourly while the page stays open (the server only asks GitHub every few hours).
  clearTimeout(timer);
  timer = setTimeout(() => loadVersion(), 60 * 60 * 1000);
}

// "Not now" hides the alert for that version only; a newer release brings it back.
const KEY = 'featherkeeper:update-dismissed';
export function dismissedVersion() {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
export function dismissUpdate(version) {
  try {
    localStorage.setItem(KEY, version);
  } catch {
    /* storage unavailable */
  }
}
