import { loadCatalogue } from '../lib/access.js';
import { catalogueArea } from '../lib/area.js';
import { HttpError } from '../lib/errors.js';
import { ebirdSourceBody } from './dex.js';

export default async function ebirdRoutes(app, { db, ebird, geocoder }) {
  /**
   * Find a place by name. With `catalogue`, eBird hotspots near that catalogue's area come first
   * (birders' place names), then towns, parks and addresses from the geocoder, biased to the area.
   * Each result: { name, label, latitude, longitude, source: 'hotspot' | 'map', kind }.
   */
  app.get(
    '/places',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 2, maxLength: 200 },
            catalogue: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (request) => {
      request.requireUser();
      const q = request.query.q.trim();
      const language = String(request.headers['accept-language'] ?? 'en').split(',')[0].slice(0, 20);

      let near = null;
      if (request.query.catalogue) {
        const { catalogue } = await loadCatalogue(db, request.query.catalogue, request.user);
        const area = await catalogueArea(db, catalogue.id);
        if (area && area.kind !== 'region') near = { latitude: area.latitude, longitude: area.longitude };
      }

      const [hotspots, places] = await Promise.all([
        near && ebird.enabled ? ebird.searchHotspots(q, near.latitude, near.longitude, 50).catch(() => []) : [],
        geocoder.enabled ? geocoder.search(q, language, near).catch((err) => ({ error: err.message })) : [],
      ]);
      if (!Array.isArray(places) && !hotspots.length) {
        throw new HttpError(502, places.error);
      }
      return {
        places: [
          ...hotspots.map((h) => ({
            name: h.name,
            label: `${h.speciesAllTime} species recorded, ${h.distanceKm.toFixed(0)} km away`,
            latitude: h.latitude,
            longitude: h.longitude,
            source: 'hotspot',
            kind: 'hotspot',
          })),
          ...(Array.isArray(places) ? places : []).map((p) => ({ ...p, source: 'map' })),
        ],
      };
    },
  );

  // A place name for a point (from a photo's GPS or the map pin): the nearest eBird hotspot
  // within 1 km if there is one, otherwise a park or town name from the geocoder.
  app.get(
    '/places/reverse',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: {
          type: 'object',
          required: ['latitude', 'longitude'],
          properties: {
            latitude: { type: 'number', minimum: -90, maximum: 90 },
            longitude: { type: 'number', minimum: -180, maximum: 180 },
          },
        },
      },
    },
    async (request) => {
      request.requireUser();
      const { latitude, longitude } = request.query;
      const language = String(request.headers['accept-language'] ?? 'en').split(',')[0].slice(0, 20);
      const [hotspot, place] = await Promise.all([
        ebird.enabled ? ebird.nearestHotspot(latitude, longitude, 1).catch(() => null) : null,
        geocoder.reverse(latitude, longitude, language).catch(() => null),
      ]);
      const suggestion = hotspot ? { name: hotspot.name, source: 'hotspot' } : place ? { name: place.name, source: 'map' } : null;
      return { suggestion, hotspot, place };
    },
  );

  /**
   * What an import would add, before anything is saved. Works before the catalogue exists
   * (new-catalogue form); pass `catalogue` to mark species that are already in it.
   */
  app.post(
    '/ebird/preview',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } }, schema: { body: ebirdSourceBody } },
    async (request) => {
      request.requireUser();
      const { codes, summary } = await ebird.speciesCodesFor(request.body);
      const taxa = codes.length ? await ebird.taxonomy(codes) : [];

      let present = new Set();
      if (request.body.catalogue) {
        const { catalogue } = await loadCatalogue(db, request.body.catalogue, request.user);
        const rows = await db.many(
          `SELECT sp.ebird_code FROM catalogue_species cs JOIN species sp ON sp.id = cs.species_id
            WHERE cs.catalogue_id = $1 AND sp.ebird_code IS NOT NULL`,
          [catalogue.id],
        );
        present = new Set(rows.map((r) => r.ebird_code));
      }
      return { source: summary, species: taxa.map((t) => ({ ...t, inCatalogue: present.has(t.ebirdCode) })) };
    },
  );
}
