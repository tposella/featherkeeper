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
    /** near: optional { latitude, longitude } to prefer results around that point. */
    async search(query, language = 'en', near = null) {
      if (!enabled) throw new HttpError(503, 'Place search is switched off on this site. Click the map instead.');
      const bias = near ? `${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}` : '';
      const key = `${language}:${bias}:${query.toLowerCase()}`;
      if (cache.has(key)) return cache.get(key);

      // Stay within the public server's one-request-per-second policy.
      const wait = lastCall + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();

      const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', addressdetails: '0' });
      if (near) {
        // A ~100 km box around the point; bounded=0 keeps results elsewhere, just ranked lower.
        const d = 0.9;
        params.set('viewbox', [near.longitude - d * 1.6, near.latitude + d, near.longitude + d * 1.6, near.latitude - d].join(','));
        params.set('bounded', '0');
      }
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

    /** A short human name for a point: "Glenbow Ranch Provincial Park, Cochrane", or the town. */
    async reverse(latitude, longitude, language = 'en') {
      if (!enabled) return null;
      const key = `rev:${language}:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      if (cache.has(key)) return cache.get(key);
      const wait = lastCall + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      const params = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        format: 'jsonv2',
        zoom: '16',
        addressdetails: '1',
      });
      let r;
      try {
        const res = await fetchImpl(`${url.replace(/\/+$/, '')}/reverse?${params}`, {
          headers: { 'User-Agent': userAgent, Accept: 'application/json', 'Accept-Language': language },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;
        r = await res.json();
      } catch {
        return null;
      }
      if (!r || r.error) return null;
      const a = r.address ?? {};
      // A named natural or leisure feature (park, reserve, lake) is the most useful name for a birder.
      const feature = ['leisure', 'natural', 'boundary', 'tourism', 'water', 'waterway'].includes(r.category) ? r.name : null;
      const area = a.park ?? a.nature_reserve ?? feature ?? null;
      const town = a.village ?? a.town ?? a.city ?? a.hamlet ?? a.municipality ?? a.county ?? null;
      const name = [...new Set([area, town].filter(Boolean))].join(', ') || String(r.display_name ?? '').split(',').slice(0, 2).join(',').trim();
      const place = name ? { name, label: r.display_name ?? name } : null;
      cache.set(key, place);
      return place;
    },
  };
}
