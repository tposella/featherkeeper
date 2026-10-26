import { api } from './api.js';
import { formatDate } from './format.js';

/**
 * Spot photos that are already in a catalogue before uploading them again. The browser computes
 * each file's SHA-256 fingerprint (the server stores the same for every photo) and asks which
 * exist. Browsers only allow this on https:// or localhost; elsewhere the check is skipped.
 */
export async function fingerprint(file) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** For each item ({ file, ... }), sets item.duplicates to [{ commonName, takenAt, speciesId }] when it's already there. */
export async function markDuplicates(slug, items) {
  try {
    const hashes = await Promise.all(items.map((i) => fingerprint(i.file)));
    items.forEach((item, n) => (item.sha256 = hashes[n]));
    const known = hashes.filter(Boolean);
    if (!known.length) return;
    const { duplicates } = await api.post(`/catalogues/${slug}/photos/check`, { hashes: [...new Set(known)] });
    for (const item of items) item.duplicates = item.sha256 ? duplicates[item.sha256] ?? null : null;
  } catch {
    /* a failed check never blocks an upload */
  }
}

export function describeDuplicate(d) {
  const first = d[0];
  return `${first.commonName}${first.takenAt ? `, ${formatDate(first.takenAt)}` : ''}`;
}
