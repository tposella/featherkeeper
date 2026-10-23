import { loadCatalogue, locationsVisible, requireEdit } from '../lib/access.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import * as out from '../lib/serialize.js';

const slugParam = { type: 'object', required: ['slug'], properties: { slug: { type: 'string', maxLength: 64 } } };
const entryParams = {
  type: 'object',
  required: ['slug', 'speciesId'],
  properties: { slug: { type: 'string', maxLength: 64 }, speciesId: { type: 'integer' } },
};
/**
 * Where an eBird import gets its species: a whole region ({ regionCode }) or the
 * hotspots around a place ({ latitude, longitude, radiusKm }). `codes` narrows it to a picked subset.
 */
export const ebirdSourceBody = {
  type: 'object',
  properties: {
    regionCode: { type: 'string', minLength: 2, maxLength: 20 },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    radiusKm: { type: 'integer', minimum: 1, maximum: 50 },
    areaLabel: { type: 'string', maxLength: 300 },
    codes: { type: 'array', maxItems: 3000, items: { type: 'string', pattern: '^[a-z0-9]{1,12}$' } },
    catalogue: { type: 'string', maxLength: 64 },
  },
  anyOf: [{ required: ['regionCode'] }, { required: ['latitude', 'longitude'] }],
};

export const DEX_SQL = `
  SELECT sp.*, cs.notes, cs.added_at,
         coalesce(st.sighting_count, 0)::int AS sighting_count,
         coalesce(st.photo_count, 0)::int AS photo_count,
         st.first_observed, st.last_observed,
         coalesce(cs.cover_photo_id, st.latest_photo_id) AS cover_photo_id,
         cs.cover_photo_id AS chosen_cover_id
    FROM catalogue_species cs
    JOIN species sp ON sp.id = cs.species_id
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT s.id) AS sighting_count,
             count(p.id) AS photo_count,
             min(s.observed_at) AS first_observed,
             max(s.observed_at) AS last_observed,
             (SELECT p2.id FROM photos p2 JOIN sightings s2 ON s2.id = p2.sighting_id
               WHERE s2.catalogue_id = cs.catalogue_id AND s2.species_id = cs.species_id
               ORDER BY p2.created_at DESC LIMIT 1) AS latest_photo_id
        FROM sightings s LEFT JOIN photos p ON p.sighting_id = s.id
       WHERE s.catalogue_id = cs.catalogue_id AND s.species_id = cs.species_id
    ) st ON true
   WHERE cs.catalogue_id = $1`;

export function dexEntry(r) {
  return {
    ...out.species(r),
    notes: r.notes,
    addedAt: out.iso(r.added_at),
    sightingCount: r.sighting_count,
    photoCount: r.photo_count,
    firstObserved: out.iso(r.first_observed),
    lastObserved: out.iso(r.last_observed),
    // "photographed" is the pokedex "caught" state; "logged" means seen but no photo yet.
    status: r.photo_count > 0 ? 'photographed' : r.sighting_count > 0 ? 'logged' : 'missing',
    coverUrl: r.cover_photo_id ? `/api/photos/${r.cover_photo_id}/thumb` : null,
    // The photo shown for this species, and whether someone picked it (otherwise it's the newest).
    coverPhotoId: r.cover_photo_id ?? null,
    coverChosen: r.chosen_cover_id !== null && r.chosen_cover_id !== undefined,
  };
}

/** Find-or-create a species row from eBird taxonomy, matching by code then scientific name. */
async function upsertTaxon(t, taxon) {
  const fields = [
    taxon.ebirdCode,
    taxon.commonName,
    taxon.scientificName,
    taxon.familyCommon,
    taxon.familyScientific,
    taxon.taxonOrder,
    taxon.taxonSort,
  ];
  const existing =
    (await t.one('SELECT id FROM species WHERE ebird_code = $1', [taxon.ebirdCode])) ??
    (await t.one('SELECT id FROM species WHERE lower(scientific_name) = lower($1)', [taxon.scientificName]));
  if (existing) {
    await t.query(
      `UPDATE species SET ebird_code = $2, common_name = $3, scientific_name = $4, family_common = $5,
              family_scientific = $6, taxon_order = $7, taxon_sort = $8
        WHERE id = $1`,
      [existing.id, ...fields],
    );
    return existing.id;
  }
  const row = await t.one(
    `INSERT INTO species (ebird_code, common_name, scientific_name, family_common, family_scientific, taxon_order, taxon_sort)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    fields,
  );
  return row.id;
}

export default async function dexRoutes(app, { db, ebird }) {
  // The full checklist for a catalogue, in taxonomic order. The frontend filters and searches it.
  app.get('/catalogues/:slug/species', { schema: { params: slugParam } }, async (request) => {
    const { catalogue } = await loadCatalogue(db, request.params.slug, request.user);
    const rows = await db.many(`${DEX_SQL} ORDER BY sp.taxon_sort NULLS LAST, sp.common_name`, [catalogue.id]);
    return { species: rows.map(dexEntry) };
  });

  app.get(
    '/catalogues/:slug/species/:speciesId',
    { schema: { params: entryParams } },
    async (request) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      const entry = await db.one(`${DEX_SQL} AND cs.species_id = $2`, [catalogue.id, request.params.speciesId]);
      if (!entry) throw notFound('That species is not in this catalogue');

      const showLocation = locationsVisible(catalogue, access);
      const sightings = await db.many(
        `SELECT s.*, u.display_name AS created_by_name
           FROM sightings s LEFT JOIN users u ON u.id = s.created_by
          WHERE s.catalogue_id = $1 AND s.species_id = $2
          ORDER BY s.observed_at DESC NULLS LAST, s.created_at DESC`,
        [catalogue.id, request.params.speciesId],
      );
      const photos = sightings.length
        ? await db.many('SELECT * FROM photos WHERE sighting_id = ANY($1) ORDER BY taken_at NULLS LAST, created_at', [
            sightings.map((s) => s.id),
          ])
        : [];
      // Replace marks are the editors' to-do list, so only they see them.
      const photoOpts = { showLocation, canDownloadOriginal: showLocation, showReplace: access.canEdit };
      return {
        entry: dexEntry(entry),
        sightings: sightings.map((s) => ({
          ...out.sighting(s, { showLocation }),
          photos: photos.filter((p) => p.sighting_id === s.id).map((p) => out.photo(p, photoOpts)),
        })),
      };
    },
  );

  // Add a species to the dex: an existing reference species by id, or a new one typed by hand.
  app.post(
    '/catalogues/:slug/species',
    {
      schema: {
        params: slugParam,
        body: {
          type: 'object',
          properties: {
            speciesId: { type: 'integer' },
            ebirdCode: { type: 'string', pattern: '^[a-z0-9]{1,12}$' },
            commonName: { type: 'string', minLength: 1, maxLength: 200 },
            scientificName: { type: 'string', minLength: 1, maxLength: 200 },
            familyCommon: { type: 'string', maxLength: 200 },
            familyScientific: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      requireEdit(access, request.user);
      const b = request.body;

      let speciesId = b.speciesId;
      if (!speciesId && b.ebirdCode) {
        // Added by eBird code (e.g. an accepted AI suggestion): take names and taxonomy from eBird.
        const existing = await db.one('SELECT id FROM species WHERE ebird_code = $1', [b.ebirdCode]);
        if (existing) {
          speciesId = existing.id;
        } else {
          const [taxon] = await ebird.taxonomy([b.ebirdCode]);
          if (!taxon) throw notFound('eBird has no species with that code');
          speciesId = await db.tx((t) => upsertTaxon(t, taxon));
        }
      }
      if (speciesId) {
        if (!(await db.one('SELECT 1 FROM species WHERE id = $1', [speciesId]))) throw notFound('Species not found');
      } else {
        const commonName = b.commonName?.trim();
        const scientificName = b.scientificName?.trim();
        if (!commonName || !scientificName) throw badRequest('Common and scientific names are both required');
        const existing = await db.one('SELECT id FROM species WHERE lower(scientific_name) = lower($1)', [
          scientificName,
        ]);
        speciesId =
          existing?.id ??
          (
            await db.one(
              `INSERT INTO species (common_name, scientific_name, family_common, family_scientific)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [commonName, scientificName, b.familyCommon?.trim() || null, b.familyScientific?.trim() || null],
            )
          ).id;
      }

      const inserted = await db.one(
        `INSERT INTO catalogue_species (catalogue_id, species_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING species_id`,
        [catalogue.id, speciesId],
      );
      await db.query('UPDATE catalogues SET updated_at = now() WHERE id = $1', [catalogue.id]);
      const entry = await db.one(`${DEX_SQL} AND cs.species_id = $2`, [catalogue.id, speciesId]);
      return reply.code(inserted ? 201 : 200).send({ entry: dexEntry(entry), added: Boolean(inserted) });
    },
  );

  app.patch(
    '/catalogues/:slug/species/:speciesId',
    {
      schema: {
        params: entryParams,
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            notes: { type: 'string', maxLength: 10000 },
            coverPhotoId: { type: ['integer', 'null'] },
          },
        },
      },
    },
    async (request) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      requireEdit(access, request.user);
      const { speciesId } = request.params;
      const b = request.body;

      if (b.coverPhotoId) {
        const ok = await db.one(
          `SELECT 1 FROM photos p JOIN sightings s ON s.id = p.sighting_id
            WHERE p.id = $1 AND s.catalogue_id = $2 AND s.species_id = $3`,
          [b.coverPhotoId, catalogue.id, speciesId],
        );
        if (!ok) throw badRequest('That photo does not belong to this species in this catalogue');
      }
      const res = await db.query(
        `UPDATE catalogue_species SET
           notes = coalesce($3, notes),
           cover_photo_id = CASE WHEN $4 THEN $5::bigint ELSE cover_photo_id END
         WHERE catalogue_id = $1 AND species_id = $2`,
        [catalogue.id, speciesId, b.notes ?? null, 'coverPhotoId' in b, b.coverPhotoId ?? null],
      );
      if (!res.rowCount) throw notFound('That species is not in this catalogue');
      const entry = await db.one(`${DEX_SQL} AND cs.species_id = $2`, [catalogue.id, speciesId]);
      return { entry: dexEntry(entry) };
    },
  );

  app.delete('/catalogues/:slug/species/:speciesId', { schema: { params: entryParams } }, async (request) => {
    const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
    requireEdit(access, request.user);
    const used = await db.one('SELECT count(*)::int AS n FROM sightings WHERE catalogue_id = $1 AND species_id = $2', [
      catalogue.id,
      request.params.speciesId,
    ]);
    if (used.n > 0) {
      throw conflict(`This species has ${used.n} sighting(s). Delete them first.`, 'has_sightings');
    }
    const res = await db.query('DELETE FROM catalogue_species WHERE catalogue_id = $1 AND species_id = $2', [
      catalogue.id,
      request.params.speciesId,
    ]);
    if (!res.rowCount) throw notFound('That species is not in this catalogue');
    return { ok: true };
  });

  // Search the shared species reference (for "add a species").
  app.get(
    '/species',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: { q: { type: 'string', minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request) => {
      request.requireUser();
      const q = request.query.q.trim();
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await db.many(
        `SELECT * FROM species
          WHERE common_name ILIKE $1 OR scientific_name ILIKE $1 OR ebird_code = lower($2)
          ORDER BY (lower(common_name) = lower($2)) DESC, (common_name ILIKE $3) DESC, common_name
          LIMIT 25`,
        [like, q, `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
      );
      return { species: rows.map(out.species) };
    },
  );

  // ---- eBird import ---------------------------------------------------------
  // Preview lives in routes/ebird.js (it also works before a catalogue exists).

  app.post(
    '/catalogues/:slug/import/ebird',
    {
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
      schema: { params: slugParam, body: ebirdSourceBody },
    },
    async (request) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      requireEdit(access, request.user);
      const b = request.body;

      const { codes: sourceCodes, summary } = await ebird.speciesCodesFor(b);
      // If the caller picked a subset, only import codes that really come from this source.
      const wanted = b.codes ? new Set(b.codes) : null;
      const codes = wanted ? sourceCodes.filter((c) => wanted.has(c)) : sourceCodes;
      const taxa = codes.length ? await ebird.taxonomy(codes) : [];

      return db.tx(async (t) => {
        let added = 0;
        for (const taxon of taxa) {
          const speciesId = await upsertTaxon(t, taxon);
          const ins = await t.one(
            `INSERT INTO catalogue_species (catalogue_id, species_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING RETURNING species_id`,
            [catalogue.id, speciesId],
          );
          if (ins) added += 1;
        }
        // Remember where the list came from, so the catalogue can show and refresh it.
        if (summary.kind === 'area') {
          await t.query(
            `UPDATE catalogues SET area_label = coalesce($2, area_label), area_latitude = $3, area_longitude = $4,
                    area_radius_km = $5, region_code = coalesce(region_code, $6), updated_at = now()
              WHERE id = $1`,
            [catalogue.id, b.areaLabel?.trim() || null, summary.latitude, summary.longitude, summary.radiusKm, summary.regionCode],
          );
        } else {
          await t.query('UPDATE catalogues SET region_code = coalesce(region_code, $2), updated_at = now() WHERE id = $1', [
            catalogue.id,
            summary.regionCode,
          ]);
        }
        return { added, alreadyPresent: taxa.length - added, total: taxa.length, source: summary };
      });
    },
  );
}
