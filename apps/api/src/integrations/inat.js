/**
 * iNaturalist observation counts, used for "usually around this month": how many research-grade
 * bird observations each species has near a point in a given calendar month over recent years.
 * iNaturalist observations are photo-backed, so these counts reflect what people manage to photograph.
 * Free API, no key; results are cached for a day.
 */
const BIRDS_TAXON_ID = 3;
const TTL_MS = 24 * 60 * 60 * 1000;

export function createInaturalistClient({ enabled = true, userAgent }, fetchImpl = globalThis.fetch) {
  const cache = new Map();

  async function getJson(url) {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`iNaturalist returned HTTP ${res.status}`);
    return res.json();
  }

  function cached(key, ttl, load) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
    return load().then((value) => {
      cache.set(key, { value, expires: Date.now() + ttl });
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      return value;
    });
  }

  const near = (area) =>
    `lat=${area.latitude.toFixed(4)}&lng=${area.longitude.toFixed(4)}&radius=${Math.round(area.radiusKm)}`;

  return {
    enabled,

    /** iNaturalist's id for a species, by scientific name (null if not found). */
    async taxonId(scientificName) {
      if (!enabled) return null;
      const name = scientificName.trim();
      return cached(`taxon:${name.toLowerCase()}`, 7 * TTL_MS, async () => {
        const body = await getJson(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=species&per_page=5`);
        const t = (body.results ?? []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
        return t ? { id: t.id, wikipediaUrl: t.wikipedia_url ?? null } : null;
      });
    },

    /** Research-grade observations per calendar month (index 0 = January) near an area, all years. */
    async monthHistogram(taxonId, area) {
      return cached(`months:${taxonId}:${near(area)}`, TTL_MS, async () => {
        const body = await getJson(
          `https://api.inaturalist.org/v1/observations/histogram?taxon_id=${taxonId}&${near(area)}` +
            '&date_field=observed&interval=month_of_year&quality_grade=research',
        );
        const m = body.results?.month_of_year ?? {};
        return Array.from({ length: 12 }, (_, i) => Number(m[i + 1] ?? 0));
      });
    },

    /**
     * Local hour of day of recent research-grade observations near an area (index 0 = midnight),
     * from up to 200 observations that recorded a time.
     */
    async hourHistogram(taxonId, area) {
      return cached(`hours:${taxonId}:${near(area)}`, TTL_MS, async () => {
        const body = await getJson(
          `https://api.inaturalist.org/v1/observations?taxon_id=${taxonId}&${near(area)}` +
            '&quality_grade=research&per_page=200&order=desc&order_by=observed_on',
        );
        const hours = new Array(24).fill(0);
        let sample = 0;
        for (const o of body.results ?? []) {
          // time_observed_at is local time with its UTC offset, e.g. 2023-05-14T07:32:00-06:00.
          const m = /T(\d{2}):/.exec(o.time_observed_at ?? '');
          if (!m) continue;
          hours[Number(m[1])] += 1;
          sample += 1;
        }
        return { hours, sample };
      });
    },

    /**
     * Species observed within radiusKm of a point in `month` (1-12, or null for every month) during the
     * last `years` full years plus the current one. Returns [{ scientificName, commonName, observations }], most observed first.
     */
    async monthlySpecies({ latitude, longitude, radiusKm, month, years = 5 }) {
      if (!enabled) return [];
      const thisYear = new Date().getUTCFullYear();
      const key = `${latitude.toFixed(2)},${longitude.toFixed(2)},${radiusKm},${month ?? 'all'},${years}`;
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;

      const params = new URLSearchParams({
        taxon_id: String(BIRDS_TAXON_ID),
        lat: latitude.toFixed(4),
        lng: longitude.toFixed(4),
        radius: String(radiusKm),
        ...(month ? { month: String(month) } : {}),
        d1: `${thisYear - years}-01-01`,
        quality_grade: 'research',
        per_page: '500',
      });
      const body = await getJson(`https://api.inaturalist.org/v1/observations/species_counts?${params}`);
      // Fold subspecies into their species ("Junco hyemalis oreganus" -> "Junco hyemalis").
      const bySpecies = new Map();
      for (const r of body.results ?? []) {
        const t = r.taxon ?? {};
        if (!t.name || !['species', 'subspecies'].includes(t.rank)) continue;
        const name = t.name.split(' ').slice(0, 2).join(' ');
        const prev = bySpecies.get(name);
        bySpecies.set(name, {
          scientificName: name,
          commonName: prev?.commonName ?? (t.rank === 'species' ? t.preferred_common_name : null) ?? null,
          observations: (prev?.observations ?? 0) + (r.count ?? 0),
        });
      }
      const value = [...bySpecies.values()].sort((a, b) => b.observations - a.observations);
      cache.set(key, { value, expires: Date.now() + TTL_MS });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return value;
    },
  };
}
