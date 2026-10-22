import { HttpError } from '../lib/errors.js';

/**
 * Place search for "find my city". Uses a Nominatim-compatible server:
 * OpenStreetMap's public one by default (fine for occasional searches; its usage
 * policy asks for at most 1 request per second), or your own via GEOCODER_URL.
 * Set GEOCODER_URL to an empty string to switch place search off.
 */
export function createGeocoder({ url, userAgent }, fetchImpl = globalThis.fetch) {
  const enabled = Boolean(url);
  const cache = new Map();
  let lastCall = 0;

  return {
    enabled,
    async search(query, language = 'en') {
      if (!enabled) throw new HttpError(503, 'Place search is switched off on this site. Click the map instead.');
      const key = `${language}:${query.toLowerCase()}`;
      if (cache.has(key)) return cache.get(key);

      // Stay within the public server's one-request-per-second policy.
      const wait = lastCall + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();

      const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', addressdetails: '0' });
      let res;
      try {
        res = await fetchImpl(`${url.replace(/\/+$/, '')}/search?${params}`, {
          headers: { 'User-Agent': userAgent, Accept: 'application/json', 'Accept-Language': language },
          signal: AbortSignal.timeout(15000),
        });
      } catch (err) {
        throw new HttpError(502, `Place search is unavailable: ${err.message}`);
      }
      if (!res.ok) throw new HttpError(502, `Place search returned HTTP ${res.status}`);
      const rows = await res.json();
      const places = (Array.isArray(rows) ? rows : [])
        .map((r) => ({
          label: r.display_name,
          name: r.name || String(r.display_name ?? '').split(',')[0],
          latitude: Number(r.lat),
          longitude: Number(r.lon),
          kind: r.addresstype ?? r.type ?? null,
        }))
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

      cache.set(key, places);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return places;
    },
  };
}
