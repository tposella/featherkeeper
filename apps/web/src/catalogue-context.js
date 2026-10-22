import { inject } from 'vue';

export const CATALOGUE_KEY = Symbol('catalogue');

/**
 * Inside /c/:slug/* views: { catalogue (ref), species (ref, the dex list), reload(), reloadDex() }.
 * Provided by CatalogueView.
 */
export function useCatalogue() {
  const ctx = inject(CATALOGUE_KEY);
  if (!ctx) throw new Error('useCatalogue() used outside a catalogue page');
  return ctx;
}
