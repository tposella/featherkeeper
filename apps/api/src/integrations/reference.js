/**
 * Reference photos of a species, so people can compare an AI suggestion with what the bird
 * really looks like. Photos come from iNaturalist's curated taxon photos (openly licensed ones
 * only, with the photographer's credit), falling back to the Wikipedia article's lead image.
 * Results are cached in memory for a week.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PHOTOS = 4;

function createCache(maxEntries = 2000) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit || hit.expires < Date.now()) return undefined;
      return hit.value;
    },
    set(key, value) {
      store.set(key, { value, expires: Date.now() + TTL_MS });
      if (store.size > maxEntries) store.delete(store.keys().next().value);
    },
  };
}

const LICENCES = {
  cc0: 'CC0',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  'cc-by-nc': 'CC BY-NC',
  'cc-by-nc-sa': 'CC BY-NC-SA',
  'cc-by-nd': 'CC BY-ND',
  'cc-by-nc-nd': 'CC BY-NC-ND',
  pd: 'Public domain',
};

export function createReferenceClient({ enabled = true, userAgent }, fetchImpl = globalThis.fetch) {
  const cache = createCache();
  const inflight = new Map();

  async function getJson(url) {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  }

  async function fromInaturalist(scientificName) {
    const search = await getJson(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&rank=species&per_page=5`,
    );
    const taxon = (search.results ?? []).find((t) => t.name?.toLowerCase() === scientificName.toLowerCase());
    if (!taxon) return null;
    const detail = await getJson(`https://api.inaturalist.org/v1/taxa/${taxon.id}`);
    const full = detail.results?.[0] ?? taxon;
    const photos = (full.taxon_photos ?? [])
      .map((tp) => tp.photo)
      .filter((p) => p && p.license_code && LICENCES[p.license_code] && p.medium_url)
      .slice(0, MAX_PHOTOS)
      .map((p) => ({
        thumb: p.square_url ?? p.url ?? p.medium_url,
        url: p.medium_url.replace('/medium.', '/large.'),
        medium: p.medium_url,
        credit: p.attribution ?? '',
        licence: LICENCES[p.license_code],
        source: 'iNaturalist',
        page: `https://www.inaturalist.org/photos/${p.id}`,
      }));
    return {
      photos,
      links: {
        inaturalist: `https://www.inaturalist.org/taxa/${taxon.id}`,
        wikipedia: full.wikipedia_url ?? null,
      },
    };
  }

  async function fromWikipedia(title) {
    const summary = await getJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    );
    const img = summary.originalimage ?? summary.thumbnail;
    const page = summary.content_urls?.desktop?.page ?? null;
    if (!img?.source) return { photos: [], page };
    const thumb = summary.thumbnail?.source ?? img.source;
    return {
      photos: [
        {
          thumb,
          url: img.source,
          medium: thumb,
          credit: 'Wikipedia lead image',
          licence: 'see Wikimedia Commons',
          source: 'Wikipedia',
          page,
        },
      ],
      page,
    };
  }

  async function load(scientificName, commonName) {
    let result = { photos: [], links: { inaturalist: null, wikipedia: null } };
    try {
      result = (await fromInaturalist(scientificName)) ?? result;
    } catch {
      /* fall through to Wikipedia */
    }
    if (!result.photos.length) {
      for (const title of [result.links.wikipedia?.split('/wiki/')[1], scientificName, commonName].filter(Boolean)) {
        try {
          const wiki = await fromWikipedia(decodeURIComponent(title));
          if (wiki.photos.length) {
            result.photos = wiki.photos;
            result.links.wikipedia ??= wiki.page;
            break;
          }
        } catch {
          /* try the next title */
        }
      }
    }
    return result;
  }

  return {
    enabled,
    /** { photos: [{ thumb, url, medium, credit, licence, source, page }], links: { inaturalist, wikipedia } } */
    async forSpecies(scientificName, commonName) {
      if (!enabled) return { photos: [], links: { inaturalist: null, wikipedia: null } };
      const key = scientificName.trim().toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      if (!inflight.has(key)) {
        inflight.set(
          key,
          load(scientificName.trim(), commonName?.trim())
            .then((value) => {
              // Don't cache an empty answer for long: it may have been a network blip.
              if (value.photos.length) cache.set(key, value);
              return value;
            })
            .finally(() => inflight.delete(key)),
        );
      }
      return inflight.get(key);
    },
  };
}
