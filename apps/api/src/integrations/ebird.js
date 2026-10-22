import { HttpError } from '../lib/errors.js';

// eBird region codes: country (CA), subnational1 (CA-AB), subnational2 (US-NY-109), or a hotspot (L123456).
export const REGION_PATTERN = /^([A-Z]{2}(-[A-Z0-9]{1,3}){0,2}|L\d+)$/;

export const MAX_RADIUS_KM = 50;
// Hotspots are ranked by all-time species count and the richest ones are combined.
// More hotspots add few new species but cost one API call each.
const MAX_HOTSPOTS = 20;
// Parallel requests to eBird; it rate-limits bursts, so keep this small.
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 4;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Small time-limited cache so a preview followed by an import doesn't hit eBird twice. */
function createCache(ttlMs, maxEntries = 500) {
  const store = new Map();
  return {
    async get(key, load) {
      const hit = store.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;
      const value = await load();
      store.set(key, { value, expires: Date.now() + ttlMs });
      if (store.size > maxEntries) store.delete(store.keys().next().value);
      return value;
    },
  };
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Minimal eBird API 2.0 client.
 * Docs: https://documenter.getpostman.com/view/664302/S1ENwy59
 */
export function createEbirdClient({ apiKey, baseUrl }, fetchImpl = globalThis.fetch) {
  const enabled = Boolean(apiKey);
  const cache = createCache(CACHE_TTL_MS);

  async function get(pathAndQuery) {
    for (let attempt = 1; ; attempt += 1) {
      let res;
      try {
        res = await fetchImpl(`${baseUrl}${pathAndQuery}`, {
          headers: { 'X-eBirdApiToken': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(30000),
        });
      } catch (err) {
        throw new HttpError(502, `Could not reach eBird: ${err.message}`);
      }
      // Rate limited or briefly unavailable: wait (as told, or with backoff) and retry.
      if ((res.status === 429 || res.status === 503) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 15000)));
        continue;
      }
      if (res.status === 400 || res.status === 404) throw new HttpError(400, 'eBird did not recognise that region');
      if (res.status === 401 || res.status === 403) throw new HttpError(502, 'eBird rejected the API key. Check EBIRD_API_KEY.');
      if (res.status === 429) throw new HttpError(503, 'eBird is rate-limiting requests. Try again in a minute.');
      if (!res.ok) throw new HttpError(502, `eBird returned HTTP ${res.status}`);
      return res.json();
    }
  }

  function requireEnabled() {
    if (!enabled) throw new HttpError(503, 'eBird import is not configured. Set EBIRD_API_KEY.');
  }

  /** Species codes ever reported in a region or at a hotspot. */
  async function speciesCodes(code) {
    return cache.get(`spplist:${code}`, async () => {
      const codes = await get(`/product/spplist/${encodeURIComponent(code)}`);
      return Array.isArray(codes) ? codes.filter((c) => typeof c === 'string') : [];
    });
  }

  async function regionName(code) {
    try {
      return await cache.get(`region:${code}`, async () => {
        const info = await get(`/ref/region/info/${encodeURIComponent(code)}`);
        return typeof info?.result === 'string' ? info.result : code;
      });
    } catch {
      return code;
    }
  }

  async function nearbyHotspots(latitude, longitude, radiusKm) {
    const lat = latitude.toFixed(2);
    const lng = longitude.toFixed(2);
    return cache.get(`hotspots:${lat},${lng},${radiusKm}`, async () => {
      const rows = await get(`/ref/hotspot/geo?lat=${lat}&lng=${lng}&dist=${radiusKm}&fmt=json`);
      return (Array.isArray(rows) ? rows : []).map((h) => ({
        locId: h.locId,
        name: h.locName,
        subnational1: h.subnational1Code ?? null,
        subnational2: h.subnational2Code ?? null,
        latitude: h.lat,
        longitude: h.lng,
        speciesAllTime: Number(h.numSpeciesAllTime ?? 0),
      }));
    });
  }

  function mostCommon(values) {
    const counts = new Map();
    for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  return {
    enabled,

    /**
     * Resolve where species come from. `source` is either
     *   { regionCode: 'CA-AB' }                               a whole eBird region
     *   { latitude, longitude, radiusKm }                     hotspots around a point
     * Returns { codes, summary } where summary describes what was used.
     */
    async speciesCodesFor(source) {
      requireEnabled();
      if (source.regionCode) {
        const regionCode = source.regionCode.trim().toUpperCase();
        if (!REGION_PATTERN.test(regionCode)) throw new HttpError(400, 'Region codes look like CA, CA-AB or US-NY-109');
        const codes = await speciesCodes(regionCode);
        return { codes, summary: { kind: 'region', regionCode, regionName: await regionName(regionCode) } };
      }

      const { latitude, longitude } = source;
      const radiusKm = Math.round(source.radiusKm ?? 25);
      if (radiusKm < 1 || radiusKm > MAX_RADIUS_KM) throw new HttpError(400, `Radius must be 1 to ${MAX_RADIUS_KM} km`);
      const hotspots = await nearbyHotspots(latitude, longitude, radiusKm);
      if (!hotspots.length) {
        throw new HttpError(404, 'eBird has no hotspots within that distance. Try a larger radius or a whole region.', 'no_hotspots');
      }
      const used = [...hotspots].sort((a, b) => b.speciesAllTime - a.speciesAllTime).slice(0, MAX_HOTSPOTS);
      const lists = await mapLimit(used, CONCURRENCY, (h) => speciesCodes(h.locId));
      const codes = [...new Set(lists.flat())];
      const district = mostCommon(hotspots.map((h) => h.subnational2)) ?? mostCommon(hotspots.map((h) => h.subnational1));
      return {
        codes,
        summary: {
          kind: 'area',
          latitude,
          longitude,
          radiusKm,
          hotspotsFound: hotspots.length,
          hotspotsUsed: used.length,
          topHotspots: used.slice(0, 5).map((h) => ({ name: h.name, species: h.speciesAllTime })),
          // The surrounding county or district, offered as a broader alternative.
          regionCode: district,
          regionName: district ? await regionName(district) : null,
        },
      };
    },

    /**
     * The most recent report of each species in the last `days` days (max 30), around a point
     * ({ latitude, longitude, radiusKm }) or in a region ({ regionCode }).
     * Returns [{ ebirdCode, commonName, scientificName, observedAt, where, howMany }].
     */
    async recentObservations(source, days = 30) {
      requireEnabled();
      const back = Math.min(30, Math.max(1, Math.round(days)));
      let path;
      if (source.regionCode) {
        path = `/data/obs/${encodeURIComponent(source.regionCode)}/recent?back=${back}&fmt=json`;
      } else {
        const dist = Math.min(50, Math.max(1, Math.round(source.radiusKm ?? 25)));
        path = `/data/obs/geo/recent?lat=${source.latitude.toFixed(2)}&lng=${source.longitude.toFixed(2)}&dist=${dist}&back=${back}&fmt=json`;
      }
      const rows = await cache.get(`recentobs:${path}`, () => get(path));
      return (Array.isArray(rows) ? rows : []).map((r) => ({
        ebirdCode: r.speciesCode,
        commonName: r.comName,
        scientificName: r.sciName,
        observedAt: r.obsDt ?? null,
        // Private (backyard) locations aren't named.
        where: r.locationPrivate ? null : (r.locName ?? null),
        howMany: typeof r.howMany === 'number' ? r.howMany : null,
      }));
    },

    /** Recent reports of one species (last 30 days), around a point or in a region, newest first. */
    async speciesReports(ebirdCode, source, days = 30) {
      requireEnabled();
      const back = Math.min(30, Math.max(1, Math.round(days)));
      const code = encodeURIComponent(ebirdCode);
      const path = source.regionCode
        ? `/data/obs/${encodeURIComponent(source.regionCode)}/recent/${code}?back=${back}&fmt=json`
        : `/data/obs/geo/recent/${code}?lat=${source.latitude.toFixed(2)}&lng=${source.longitude.toFixed(2)}` +
          `&dist=${Math.min(50, Math.max(1, Math.round(source.radiusKm ?? 25)))}&back=${back}&fmt=json`;
      const rows = await cache.get(`reports:${path}`, () => get(path));
      return (Array.isArray(rows) ? rows : [])
        .filter((r) => !r.locationPrivate)
        .map((r) => ({ where: r.locName ?? null, observedAt: r.obsDt ?? null, howMany: typeof r.howMany === 'number' ? r.howMany : null }))
        .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
    },

    /** The nearest eBird hotspot within maxKm of a point, or null. */
    async nearestHotspot(latitude, longitude, maxKm = 1) {
      requireEnabled();
      const spots = await nearbyHotspots(latitude, longitude, Math.max(1, Math.ceil(maxKm) + 1));
      let best = null;
      for (const h of spots) {
        const km = distanceKm(latitude, longitude, h.latitude, h.longitude);
        if (km <= maxKm && (!best || km < best.distanceKm)) best = { name: h.name, locId: h.locId, distanceKm: Math.round(km * 100) / 100 };
      }
      return best;
    },

    /** Species codes reported within radiusKm of a point in the last `days` days (max 30). */
    async recentSpeciesNear(latitude, longitude, radiusKm = 25, days = 30) {
      requireEnabled();
      const lat = latitude.toFixed(2);
      const lng = longitude.toFixed(2);
      const dist = Math.min(50, Math.max(1, Math.round(radiusKm)));
      const back = Math.min(30, Math.max(1, Math.round(days)));
      return cache.get(`recent:${lat},${lng},${dist},${back}`, async () => {
        const rows = await get(`/data/obs/geo/recent?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&fmt=json`);
        return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r.speciesCode).filter(Boolean))];
      });
    },

    /** Taxonomy rows for the given species codes, full species only (no hybrids, spuhs, slashes). */
    async taxonomy(codes) {
      requireEnabled();
      const out = [];
      for (let i = 0; i < codes.length; i += 100) {
        const chunk = codes.slice(i, i + 100).sort();
        const rows = await cache.get(`tax:${chunk.join(',')}`, () =>
          get(`/ref/taxonomy/ebird?fmt=json&species=${chunk.map(encodeURIComponent).join(',')}`),
        );
        for (const r of rows ?? []) {
          if (r.category !== 'species') continue;
          out.push({
            ebirdCode: r.speciesCode,
            commonName: r.comName,
            scientificName: r.sciName,
            familyCommon: r.familyComName ?? null,
            familyScientific: r.familySciName ?? null,
            taxonOrder: r.order ?? null,
            taxonSort: typeof r.taxonOrder === 'number' ? r.taxonOrder : null,
          });
        }
      }
      return out.sort((a, b) => (a.taxonSort ?? 1e9) - (b.taxonSort ?? 1e9));
    },
  };
}
