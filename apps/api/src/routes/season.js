import { loadCatalogue } from '../lib/access.js';
import { catalogueArea } from '../lib/area.js';
import { notFound } from '../lib/errors.js';
import { DEX_SQL, dexEntry } from './dex.js';

const slugParam = { type: 'object', required: ['slug'], properties: { slug: { type: 'string', maxLength: 64 } } };

function publicArea(area) {
  if (!area) return null;
  return { kind: area.kind, label: area.label ?? null, radiusKm: area.radiusKm ?? null, regionCode: area.regionCode ?? null };
}

const ebirdSource = (area) =>
  area.kind === 'region' ? { regionCode: area.regionCode } : { latitude: area.latitude, longitude: area.longitude, radiusKm: area.radiusKm };

export default async function seasonRoutes(app, { db, ebird, inat, wikipedia }) {
  /**
   * What's around: species reported in the last 30 days (eBird, current month only) and species
   * usually photographed in the chosen month over the last five years (iNaturalist).
   */
  app.get(
    '/catalogues/:slug/season',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: slugParam,
        querystring: {
          type: 'object',
          properties: {
            month: { type: 'integer', minimum: 1, maximum: 12 },
            current: { type: 'integer', minimum: 1, maximum: 12 }, // the viewer's current month
          },
        },
      },
    },
    async (request) => {
      const { catalogue } = await loadCatalogue(db, request.params.slug, request.user);
      const currentMonth = request.query.current ?? new Date().getUTCMonth() + 1;
      const month = request.query.month ?? currentMonth;
      const area = await catalogueArea(db, catalogue.id);
      const result = { month, currentMonth, area: publicArea(area), sources: {}, species: [], notInCatalogue: [] };
      if (!area) return result;

      const [now, usual] = await Promise.all([
        month === currentMonth && ebird.enabled
          ? ebird.recentObservations(ebirdSource(area)).catch((err) => ({ error: err.message }))
          : null,
        area.kind !== 'region' && inat.enabled
          ? inat
              .monthlySpecies({ latitude: area.latitude, longitude: area.longitude, radiusKm: area.radiusKm, month })
              .catch((err) => ({ error: err.message }))
          : null,
      ]);
      result.sources = {
        now: Array.isArray(now) ? 'ebird' : null,
        nowError: now?.error ?? null,
        usual: Array.isArray(usual) ? 'inaturalist' : null,
        usualError: usual?.error ?? null,
      };

      const nowByCode = new Map((Array.isArray(now) ? now : []).map((o) => [o.ebirdCode, o]));
      const usualBySci = new Map((Array.isArray(usual) ? usual : []).map((u) => [u.scientificName.toLowerCase(), u]));
      const dex = await db.many(`${DEX_SQL} ORDER BY sp.taxon_sort NULLS LAST, sp.common_name`, [catalogue.id]);
      const dexCodes = new Set();
      dex.forEach((row, i) => {
        if (row.ebird_code) dexCodes.add(row.ebird_code);
        const n = row.ebird_code ? nowByCode.get(row.ebird_code) : null;
        const u = usualBySci.get(row.scientific_name.toLowerCase());
        if (!n && !u) return;
        result.species.push({
          ...dexEntry(row),
          plate: i + 1,
          now: n ? { observedAt: n.observedAt, where: n.where, howMany: n.howMany } : null,
          usual: u ? { observations: u.observations } : null,
        });
      });
      result.notInCatalogue = [...nowByCode.values()]
        .filter((o) => !dexCodes.has(o.ebirdCode))
        .map((o) => ({ ebirdCode: o.ebirdCode, commonName: o.commonName, scientificName: o.scientificName, observedAt: o.observedAt, where: o.where }));
      return result;
    },
  );

  /** When and where to find one species: seasonality, time of day, habitat, recent reports, your own records. */
  app.get(
    '/catalogues/:slug/species/:speciesId/insights',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: {
          type: 'object',
          required: ['slug', 'speciesId'],
          properties: { slug: { type: 'string', maxLength: 64 }, speciesId: { type: 'integer' } },
        },
      },
    },
    async (request) => {
      const { catalogue } = await loadCatalogue(db, request.params.slug, request.user);
      const sp = await db.one(
        `SELECT sp.* FROM catalogue_species cs JOIN species sp ON sp.id = cs.species_id
          WHERE cs.catalogue_id = $1 AND cs.species_id = $2`,
        [catalogue.id, request.params.speciesId],
      );
      if (!sp) throw notFound('That species is not in this catalogue');
      const area = await catalogueArea(db, catalogue.id);
      const hasPoint = area && area.kind !== 'region';

      const taxon = inat.enabled ? await inat.taxonId(sp.scientific_name).catch(() => null) : null;
      const wikiTitle = taxon?.wikipediaUrl ? decodeURIComponent(taxon.wikipediaUrl.split('/wiki/')[1] ?? '') : null;

      const [months, hours, habitat, reports, yours] = await Promise.all([
        taxon && hasPoint ? inat.monthHistogram(taxon.id, area).catch(() => null) : null,
        taxon && hasPoint ? inat.hourHistogram(taxon.id, area).catch(() => null) : null,
        wikipedia.habitat([wikiTitle, sp.scientific_name, sp.common_name]).catch(() => null),
        area && sp.ebird_code && ebird.enabled ? ebird.speciesReports(sp.ebird_code, ebirdSource(area)).catch(() => null) : null,
        db.many(
          `SELECT observed_at, location_name FROM sightings
            WHERE catalogue_id = $1 AND species_id = $2 AND observed_at IS NOT NULL ORDER BY observed_at`,
          [catalogue.id, sp.id],
        ),
      ]);

      return {
        area: publicArea(area),
        months, // 12 counts, January first (iNaturalist, all years)
        hours: hours && hours.sample >= 5 ? hours : null, // local hour of day, from recent observations
        habitat,
        reports: reports ? reports.slice(0, 8) : null, // eBird, last 30 days
        // Your own records; the browser buckets these by its local month and hour.
        yours: yours.map((r) => ({ observedAt: r.observed_at, where: r.location_name || null })),
        links: {
          inaturalist: taxon ? `https://www.inaturalist.org/taxa/${taxon.id}` : null,
          ebird: sp.ebird_code ? `https://ebird.org/species/${sp.ebird_code}` : null,
        },
      };
    },
  );
}
