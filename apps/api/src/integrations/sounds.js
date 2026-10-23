/**
 * Recordings of a species' song and calls, for the "Calls and songs" section.
 *
 *   xeno-canto   used first when XENO_CANTO_API_KEY is set (free key from a xeno-canto account).
 *                Recordings are labelled song / call and quality-rated A to E.
 *   iNaturalist  no key needed: openly licensed sounds attached to research-grade observations.
 *
 * Recordings near the catalogue's area come first (birds have regional dialects).
 * Every result carries the recordist's credit and licence, which these licences require.
 * Cached for a day.
 */
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX = 8;

const INAT_LICENCES = {
  cc0: 'CC0',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  'cc-by-nc': 'CC BY-NC',
  'cc-by-nc-sa': 'CC BY-NC-SA',
  'cc-by-nd': 'CC BY-ND',
  'cc-by-nc-nd': 'CC BY-NC-ND',
};

/** "//creativecommons.org/licenses/by-nc-sa/4.0/" -> "CC BY-NC-SA 4.0" */
export function licenceFromUrl(url) {
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/?([\d.]+)?/i.exec(url ?? '');
  if (!m) return null;
  if (m[1] === 'publicdomain') return m[2] === 'zero' ? 'CC0' : 'Public domain';
  return `CC ${m[2].toUpperCase()}${m[3] ? ` ${m[3]}` : ''}`;
}

/** xeno-canto's "type" is free text like "song", "call, flight call", "alarm call". */
export function soundKind(type) {
  const t = String(type ?? '').toLowerCase();
  if (/\bsong\b/.test(t)) return 'song';
  if (/call|alarm|chip|contact/.test(t)) return 'call';
  if (/drum/.test(t)) return 'drumming';
  return null;
}

const toHttps = (u) => (u?.startsWith('//') ? `https:${u}` : u);

export function createSoundsClient({ enabled = true, userAgent, xenoCantoKey = '' }, fetchImpl = globalThis.fetch) {
  const cache = new Map();

  async function getJson(url) {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  }

  async function xenoCanto(scientificName, near) {
    const parts = [`sp:"${scientificName}"`, 'q:">C"'];
    // Prefer recordings from the same country as the catalogue's area when we know it.
    if (near?.country) parts.push(`cnt:"${near.country}"`);
    const url = `https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent(parts.join(' '))}&per_page=50&key=${encodeURIComponent(xenoCantoKey)}`;
    let body = await getJson(url);
    if (!body.recordings?.length && near?.country) {
      body = await getJson(
        `https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent(`sp:"${scientificName}" q:">C"`)}&per_page=50&key=${encodeURIComponent(xenoCantoKey)}`,
      );
    }
    return (body.recordings ?? [])
      .filter((r) => r.file && r.lic)
      .map((r) => ({
        url: toHttps(r.file),
        kind: soundKind(r.type),
        type: r.type || null,
        quality: r.q || null,
        length: r.length || null,
        where: [r.loc, r.cnt].filter(Boolean).join(', ') || null,
        latitude: Number(r.lat) || null,
        longitude: Number(r.lon ?? r.lng) || null,
        credit: r.rec ? `${r.rec}, xeno-canto XC${r.id}` : `xeno-canto XC${r.id}`,
        licence: licenceFromUrl(r.lic) ?? 'see xeno-canto',
        licenceUrl: toHttps(r.lic),
        source: 'xeno-canto',
        page: toHttps(r.url) ?? `https://xeno-canto.org/${r.id}`,
      }))
      .sort((a, b) => String(a.quality).localeCompare(String(b.quality)));
  }

  async function inaturalist(scientificName, near) {
    const taxa = await getJson(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&rank=species&per_page=5`,
    );
    const taxon = (taxa.results ?? []).find((t) => t.name?.toLowerCase() === scientificName.toLowerCase());
    if (!taxon) return [];
    const base =
      `https://api.inaturalist.org/v1/observations?taxon_id=${taxon.id}&sounds=true&quality_grade=research` +
      '&per_page=30&order_by=votes&sound_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa,cc-by-nd,cc-by-nc-nd';
    const queries = near ? [`${base}&lat=${near.latitude.toFixed(3)}&lng=${near.longitude.toFixed(3)}&radius=500`, base] : [base];
    const seen = new Set();
    const out = [];
    for (const url of queries) {
      const body = await getJson(url);
      for (const o of body.results ?? []) {
        for (const s of o.sounds ?? []) {
          if (!s.file_url || !INAT_LICENCES[s.license_code] || seen.has(s.id)) continue;
          seen.add(s.id);
          const [lat, lng] = String(o.location ?? '').split(',').map(Number);
          out.push({
            url: s.file_url,
            kind: null,
            type: null,
            quality: null,
            length: null,
            where: o.place_guess || null,
            latitude: Number.isFinite(lat) ? lat : null,
            longitude: Number.isFinite(lng) ? lng : null,
            credit: s.attribution || `iNaturalist observation ${o.id}`,
            licence: INAT_LICENCES[s.license_code],
            licenceUrl: null,
            source: 'iNaturalist',
            page: `https://www.inaturalist.org/observations/${o.id}`,
          });
        }
      }
      if (out.length >= MAX) break;
    }
    return out;
  }

  return {
    enabled,
    provider: xenoCantoKey ? 'xeno-canto' : 'inaturalist',
    /** near: optional { latitude, longitude, country } of the catalogue's area. */
    async forSpecies(scientificName, near = null) {
      if (!enabled) return [];
      const key = `${scientificName.toLowerCase()}:${near ? `${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}` : ''}`;
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;

      let list = [];
      if (xenoCantoKey) {
        try {
          list = await xenoCanto(scientificName, near);
        } catch {
          list = [];
        }
      }
      if (list.length < 3) {
        try {
          list = [...list, ...(await inaturalist(scientificName, near))];
        } catch {
          /* keep what we have */
        }
      }

      // Nearby first, then give songs and calls a fair share of the slots.
      if (near) {
        const d = (r) => (r.latitude === null ? 1e9 : Math.hypot(r.latitude - near.latitude, r.longitude - near.longitude));
        list.sort((a, b) => Math.min(d(a), 5) - Math.min(d(b), 5));
      }
      const songs = list.filter((r) => r.kind === 'song');
      const calls = list.filter((r) => r.kind === 'call');
      const others = list.filter((r) => r.kind !== 'song' && r.kind !== 'call');
      const value = [];
      while (value.length < MAX && (songs.length || calls.length || others.length)) {
        for (const pool of [songs, calls, others]) if (pool.length && value.length < MAX) value.push(pool.shift());
      }
      if (value.length) {
        cache.set(key, { value, expires: Date.now() + TTL_MS });
        if (cache.size > 2000) cache.delete(cache.keys().next().value);
      }
      return value;
    },
  };
}
