import { ref } from 'vue';

/**
 * Light and dark mode. With nothing chosen, the page follows the system setting. The header toggle
 * stores a choice in this browser; picking the same theme as the system clears it again, so the page
 * goes back to following the system. The choice is applied as data-theme on <html> (index.html also
 * does this before the app loads, so there's no flash of the wrong theme).
 */
const KEY = 'featherkeeper:theme';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
const system = () => (media?.matches ? 'dark' : 'light');

/** The theme in effect: 'light' or 'dark'. */
export const theme = ref(stored() ?? system());

function apply(choice) {
  const root = document.documentElement;
  if (choice) root.dataset.theme = choice;
  else delete root.dataset.theme;
  theme.value = choice ?? system();
}

export function toggleTheme() {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  const choice = next === system() ? null : next;
  try {
    if (choice) localStorage.setItem(KEY, choice);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts until the page is reloaded */
  }
  apply(choice);
}

apply(stored());
media?.addEventListener?.('change', () => apply(stored()));
