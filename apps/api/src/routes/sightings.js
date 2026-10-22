import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { loadCatalogue, locationsVisible, requireEdit } from '../lib/access.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { processImage } from '../lib/images.js';
import * as out from '../lib/serialize.js';

const slugParam = { type: 'object', required: ['slug'], properties: { slug: { type: 'string', maxLength: 64 } } };
const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } };

const sightingFields = {
  speciesId: { type: 'integer' },
  observedAt: { type: ['string', 'null'], format: 'date-time' },
  latitude: { type: ['number', 'null'], minimum: -90, maximum: 90 },
  longitude: { type: ['number', 'null'], minimum: -180, maximum: 180 },
  locationName: { type: 'string', maxLength: 300 },
  notes: { type: 'string', maxLength: 10000 },
};

function checkCoordinates(b) {
  const hasLat = b.latitude !== undefined && b.latitude !== null;
  const hasLng = b.longitude !== undefined && b.longitude !== null;
  if (hasLat !== hasLng) throw badRequest('Give both latitude and longitude, or neither');
}

/** Load a sighting plus its catalogue and the caller's access. 404 if they can't see it. */
async function loadSighting(db, id, user) {
  const row = await db.one('SELECT * FROM sightings WHERE id = $1', [id]);
  if (!row) throw notFound('Sighting not found');
  const { catalogue, access } = await loadCatalogue(db, row.catalogue_id, user);
  return { sighting: row, catalogue, access };
}

/**
 * Stream the uploaded file to a temporary file, so even very large photos never sit in memory.
 * Returns { path, size, filename, cleanup }. Call cleanup() when done (it's safe to call twice).
 */
async function readUpload(request, storage, maxUploadMb) {
  const file = await request.file();
  if (!file) throw badRequest('Attach a photo in the "file" field');
  const path = storage.tempPath();
  const cleanup = () => rm(path, { force: true });
  try {
    await pipeline(file.file, createWriteStream(path));
    if (file.file.truncated) throw new HttpError(413, `Photos can be at most ${maxUploadMb} MB`, 'too_large');
    const { size } = await stat(path);
    if (!size) throw badRequest('The uploaded file is empty');
    return { path, size, filename: file.filename ?? '', cleanup };
  } catch (err) {
    await cleanup();
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `Photos can be at most ${maxUploadMb} MB`, 'too_large');
    throw err;
  }
}

export default async function sightingRoutes(app, { db, storage, identifier, config }) {
  // All sightings in a catalogue (used by the map and the recent-activity list).
  app.get('/catalogues/:slug/sightings', { schema: { params: slugParam } }, async (request) => {
    const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
    const showLocation = locationsVisible(catalogue, access);
    const rows = await db.many(
      `SELECT s.*, u.display_name AS created_by_name, sp.common_name, sp.scientific_name,
              (SELECT p.id FROM photos p WHERE p.sighting_id = s.id ORDER BY p.created_at LIMIT 1) AS first_photo_id,
              (SELECT count(*) FROM photos p WHERE p.sighting_id = s.id)::int AS photo_count
         FROM sightings s
         JOIN species sp ON sp.id = s.species_id
         LEFT JOIN users u ON u.id = s.created_by
        WHERE s.catalogue_id = $1
        ORDER BY s.observed_at DESC NULLS LAST, s.created_at DESC`,
      [catalogue.id],
    );
    return {
      locationsHidden: !showLocation,
      sightings: rows.map((r) => ({
        ...out.sighting(r, { showLocation }),
        commonName: r.common_name,
        scientificName: r.scientific_name,
        photoCount: r.photo_count,
        thumbUrl: r.first_photo_id ? `/api/photos/${r.first_photo_id}/thumb` : null,
      })),
    };
  });

  app.post(
    '/catalogues/:slug/sightings',
    {
      schema: {
        params: slugParam,
        body: { type: 'object', required: ['speciesId'], properties: sightingFields },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, user);
      requireEdit(access, user);
      const b = request.body;
      checkCoordinates(b);
      const inDex = await db.one('SELECT 1 FROM catalogue_species WHERE catalogue_id = $1 AND species_id = $2', [
        catalogue.id,
        b.speciesId,
      ]);
      if (!inDex) throw badRequest('Add this species to the catalogue before logging a sighting');

      const row = await db.one(
        `INSERT INTO sightings (catalogue_id, species_id, observed_at, latitude, longitude, location_name, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          catalogue.id,
          b.speciesId,
          b.observedAt ?? null,
          b.latitude ?? null,
          b.longitude ?? null,
          b.locationName?.trim() ?? '',
          b.notes ?? '',
          user.id,
        ],
      );
      await db.query('UPDATE catalogues SET updated_at = now() WHERE id = $1', [catalogue.id]);
      return reply.code(201).send({ sighting: { ...out.sighting(row, { showLocation: true }), photos: [] } });
    },
  );

  app.patch(
    '/sightings/:id',
    { schema: { params: idParam, body: { type: 'object', minProperties: 1, properties: sightingFields } } },
    async (request) => {
      const { sighting, catalogue, access } = await loadSighting(db, request.params.id, request.user);
      requireEdit(access, request.user);
      const b = request.body;
      checkCoordinates(b);
      if (b.speciesId !== undefined) {
        const inDex = await db.one('SELECT 1 FROM catalogue_species WHERE catalogue_id = $1 AND species_id = $2', [
          catalogue.id,
          b.speciesId,
        ]);
        if (!inDex) throw badRequest('That species is not in this catalogue');
      }
      const setCoords = 'latitude' in b || 'longitude' in b;
      const row = await db.one(
        `UPDATE sightings SET
           species_id = coalesce($2, species_id),
           observed_at = CASE WHEN $3 THEN $4::timestamptz ELSE observed_at END,
           latitude = CASE WHEN $5 THEN $6::double precision ELSE latitude END,
           longitude = CASE WHEN $5 THEN $7::double precision ELSE longitude END,
           location_name = coalesce($8, location_name),
           notes = coalesce($9, notes),
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          sighting.id,
          b.speciesId ?? null,
          'observedAt' in b,
          b.observedAt ?? null,
          setCoords,
          b.latitude ?? null,
          b.longitude ?? null,
          b.locationName?.trim() ?? null,
          b.notes ?? null,
        ],
      );
      return { sighting: out.sighting(row, { showLocation: true }) };
    },
  );

  app.delete('/sightings/:id', { schema: { params: idParam } }, async (request) => {
    const { sighting, access } = await loadSighting(db, request.params.id, request.user);
    requireEdit(access, request.user);
    const keys = await db.many('SELECT storage_key FROM photos WHERE sighting_id = $1', [sighting.id]);
    await db.query('DELETE FROM sightings WHERE id = $1', [sighting.id]);
    for (const { storage_key: key } of keys) {
      await storage.remove(key).catch((err) => request.log.warn(err, 'could not delete photo files'));
    }
    return { ok: true };
  });

  // ---- Photos ---------------------------------------------------------------

  app.post('/sightings/:id/photos', { schema: { params: idParam } }, async (request, reply) => {
    const user = request.requireUser();
    const { sighting, access } = await loadSighting(db, request.params.id, user);
    requireEdit(access, user);

    const upload = await readUpload(request, storage, config.maxUploadMb);
    const key = storage.newKey();
    let row;
    try {
      const img = await processImage(upload.path);
      // The original is moved into place, never copied; derivatives are small buffers.
      await storage.save(key, { 'display.webp': img.display, 'thumb.webp': img.thumb }, { [`original.${img.ext}`]: upload.path });
      row = await db.tx(async (t) => {
        const p = await t.one(
          `INSERT INTO photos (sighting_id, storage_key, original_name, mime_type, size_bytes, width, height,
                               taken_at, camera, lens, latitude, longitude, exif, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
          [
            sighting.id,
            key,
            upload.filename.slice(0, 255),
            img.mime,
            upload.size,
            img.width,
            img.height,
            img.takenAt,
            img.camera,
            img.lens,
            img.latitude,
            img.longitude,
            img.exif,
            user.id,
          ],
        );
        // Fill in the sighting's date and place from the photo when they weren't entered.
        await t.query(
          `UPDATE sightings SET
             observed_at = coalesce(observed_at, $2),
             latitude = CASE WHEN latitude IS NULL THEN $3 ELSE latitude END,
             longitude = CASE WHEN latitude IS NULL THEN $4 ELSE longitude END,
             updated_at = now()
           WHERE id = $1`,
          [sighting.id, img.takenAt, img.latitude, img.longitude],
        );
        return p;
      });
    } catch (err) {
      await storage.remove(key).catch(() => {});
      throw err;
    } finally {
      await upload.cleanup();
    }
    return reply.code(201).send({ photo: out.photo(row, { showLocation: true, canDownloadOriginal: true }) });
  });

  app.get(
    '/photos/:id/:variant',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'variant'],
          properties: { id: { type: 'integer' }, variant: { type: 'string', enum: ['thumb', 'display', 'original'] } },
        },
      },
    },
    async (request, reply) => {
      const row = await db.one(
        `SELECT p.storage_key, p.mime_type, p.original_name, s.catalogue_id
           FROM photos p JOIN sightings s ON s.id = p.sighting_id WHERE p.id = $1`,
        [request.params.id],
      );
      if (!row) throw notFound('Photo not found');
      const { catalogue, access } = await loadCatalogue(db, row.catalogue_id, request.user);
      const { variant } = request.params;

      let name;
      let type;
      if (variant === 'original') {
        // Originals keep their EXIF (including GPS), so they follow the location privacy setting.
        if (!locationsVisible(catalogue, access)) throw notFound('Photo not found');
        name = `original.${extFor(row.mime_type)}`;
        type = row.mime_type;
        const safeName = (row.original_name || `photo-${request.params.id}`).replace(/[^\w.\- ]+/g, '_');
        reply.header('Content-Disposition', `inline; filename="${safeName}"`);
      } else {
        name = `${variant}.webp`;
        type = 'image/webp';
      }

      let file;
      try {
        file = await storage.open(row.storage_key, name);
      } catch {
        throw notFound('Photo file is missing from storage');
      }
      reply.header('Cache-Control', catalogue.visibility === 'public' ? 'public, max-age=86400' : 'private, max-age=3600');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Length', file.size);
      return reply.type(type).send(file.stream);
    },
  );

  app.delete('/photos/:id', { schema: { params: idParam } }, async (request) => {
    const row = await db.one(
      `SELECT p.id, p.storage_key, s.catalogue_id FROM photos p JOIN sightings s ON s.id = p.sighting_id WHERE p.id = $1`,
      [request.params.id],
    );
    if (!row) throw notFound('Photo not found');
    const { access } = await loadCatalogue(db, row.catalogue_id, request.user);
    requireEdit(access, request.user);
    await db.query('DELETE FROM photos WHERE id = $1', [row.id]);
    await storage.remove(row.storage_key).catch((err) => request.log.warn(err, 'could not delete photo files'));
    return { ok: true };
  });

  // ---- AI identification ------------------------------------------------------

  // Suggest species for a photo before it is saved. Results are suggestions only; the user picks.
  app.post(
    '/catalogues/:slug/identify',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } }, schema: { params: slugParam } },
    async (request) => {
      const user = request.requireUser();
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, user);
      requireEdit(access, user);
      const upload = await readUpload(request, storage, config.maxUploadMb);

      // Send a 1024 px JPEG with no metadata: faster, and no GPS leaves your server.
      let small;
      try {
        small = await sharp(upload.path, { failOn: 'none' })
          .rotate()
          .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();
      } catch {
        throw badRequest("That file isn't an image we can read");
      } finally {
        await upload.cleanup();
      }
      const predictions = await identifier.identify(small, 'image/jpeg');

      const suggestions = [];
      for (const p of predictions) {
        const match = await db.one(
          `SELECT sp.id, sp.common_name, sp.scientific_name, (cs.species_id IS NOT NULL) AS in_catalogue
             FROM species sp
             LEFT JOIN catalogue_species cs ON cs.species_id = sp.id AND cs.catalogue_id = $3
            WHERE ($1::text IS NOT NULL AND lower(sp.scientific_name) = lower($1))
               OR ($2::text IS NOT NULL AND lower(sp.common_name) = lower($2))
            ORDER BY (cs.species_id IS NOT NULL) DESC
            LIMIT 1`,
          [p.scientificName, p.commonName, catalogue.id],
        );
        suggestions.push({
          commonName: match?.common_name ?? p.commonName,
          scientificName: match?.scientific_name ?? p.scientificName,
          confidence: p.confidence,
          speciesId: match?.id ?? null,
          inCatalogue: Boolean(match?.in_catalogue),
        });
      }
      return { provider: identifier.provider, suggestions };
    },
  );
}

function extFor(mime) {
  return { 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/avif': 'avif' }[mime] ?? 'jpg';
}
