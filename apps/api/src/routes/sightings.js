import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { loadCatalogue, locationsVisible, requireEdit } from '../lib/access.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { buildCandidates } from '../lib/candidates.js';
import { openImage, processImage, readImageExif, uprightPipeline } from '../lib/images.js';
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
    // Text fields sent before the file in the same form (e.g. the map pin, an AI decision).
    const fields = Object.fromEntries(
      Object.entries(file.fields ?? {})
        .filter(([, f]) => f && f.type === 'field' && typeof f.value === 'string')
        .map(([name, f]) => [name, f.value]),
    );
    return { path, size, filename: file.filename ?? '', fields, cleanup };
  } catch (err) {
    await cleanup();
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `Photos can be at most ${maxUploadMb} MB`, 'too_large');
    throw err;
  }
}

/**
 * The AI suggestions shown for a photo and what the user did with them, sent as a JSON
 * form field "ai": { model, suggestions: [{ ebirdCode, scientificName, commonName, confidence }],
 * accepted: ebirdCode | scientificName | null, rejected: [...] }. Kept so you can see how often the model was right.
 */
function aiDecision(raw) {
  if (!raw || raw.length > 20000) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || !Array.isArray(v.suggestions)) return null;
    return {
      model: typeof v.model === 'string' ? v.model.slice(0, 200) : null,
      suggestions: v.suggestions.slice(0, 10).map((x) => ({
        ebirdCode: typeof x.ebirdCode === 'string' ? x.ebirdCode.slice(0, 20) : null,
        scientificName: String(x.scientificName ?? '').slice(0, 200),
        commonName: String(x.commonName ?? '').slice(0, 200),
        confidence: Number(x.confidence) || 0,
      })),
      accepted: typeof v.accepted === 'string' ? v.accepted.slice(0, 200) : null,
      rejected: Array.isArray(v.rejected) ? v.rejected.slice(0, 10).map((r) => String(r).slice(0, 200)) : [],
      decidedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export default async function sightingRoutes(app, { db, storage, identifier, config, ebird }) {
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
      const movingSpecies = b.speciesId !== undefined && b.speciesId !== sighting.species_id;
      const row = await db.tx(async (t) => {
        if (movingSpecies) {
          // Its photos leave the old species, so they can't stay that species' chosen thumbnail.
          await t.query(
            `UPDATE catalogue_species SET cover_photo_id = NULL
              WHERE catalogue_id = $1 AND species_id = $2
                AND cover_photo_id IN (SELECT id FROM photos WHERE sighting_id = $3)`,
            [catalogue.id, sighting.species_id, sighting.id],
          );
        }
        return t.one(
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
      });
      await db.query('UPDATE catalogues SET updated_at = now() WHERE id = $1', [catalogue.id]);
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
                               taken_at, camera, lens, latitude, longitude, exif, uploaded_by, ai_suggestions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
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
            aiDecision(upload.fields.ai),
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

  /** Mark a photo as one to replace with a better shot (with an optional note), or clear the mark. */
  app.patch(
    '/photos/:id',
    {
      schema: {
        params: idParam,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            replace: { type: 'boolean' },
            replaceNote: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request) => {
      const row = await db.one(
        `SELECT p.id, s.catalogue_id FROM photos p JOIN sightings s ON s.id = p.sighting_id WHERE p.id = $1`,
        [request.params.id],
      );
      if (!row) throw notFound('Photo not found');
      const { catalogue, access } = await loadCatalogue(db, row.catalogue_id, request.user);
      requireEdit(access, request.user);
      const b = request.body;
      const updated = await db.one(
        `UPDATE photos SET
           replace_wanted = coalesce($2::boolean, replace_wanted),
           -- Keep the date it was first marked; clearing the mark clears the date and note.
           replace_marked_at = CASE
             WHEN $2::boolean IS TRUE THEN coalesce(replace_marked_at, now())
             WHEN $2::boolean IS FALSE THEN NULL
             ELSE replace_marked_at END,
           replace_note = CASE WHEN $2::boolean IS FALSE THEN '' ELSE coalesce($3::text, replace_note) END
         WHERE id = $1 RETURNING *`,
        [row.id, b.replace ?? null, b.replaceNote ?? null],
      );
      const showLocation = locationsVisible(catalogue, access);
      return { photo: out.photo(updated, { showLocation, canDownloadOriginal: showLocation }) };
    },
  );

  /** Every photo in the catalogue marked as one to replace, newest mark first. Editors only. */
  app.get('/catalogues/:slug/to-replace', { schema: { params: slugParam } }, async (request) => {
    const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
    requireEdit(access, request.user);
    const rows = await db.many(
      `SELECT p.*, s.observed_at AS sighting_observed_at, s.location_name AS sighting_location,
              sp.id AS species_id, sp.common_name, sp.scientific_name, sp.taxon_sort,
              cs.cover_photo_id = p.id AS is_cover,
              -- Photos of the same species added since this one was marked: maybe the replacement.
              (SELECT count(*) FROM photos p2 JOIN sightings s2 ON s2.id = p2.sighting_id
                WHERE s2.catalogue_id = s.catalogue_id AND s2.species_id = s.species_id
                  AND p2.id <> p.id AND p2.created_at > p.replace_marked_at)::int AS newer_count,
              (SELECT count(*) FROM photos p3 JOIN sightings s3 ON s3.id = p3.sighting_id
                WHERE s3.catalogue_id = s.catalogue_id AND s3.species_id = s.species_id)::int AS species_photo_count
         FROM photos p
         JOIN sightings s ON s.id = p.sighting_id
         JOIN species sp ON sp.id = s.species_id
         LEFT JOIN catalogue_species cs ON cs.catalogue_id = s.catalogue_id AND cs.species_id = s.species_id
        WHERE s.catalogue_id = $1 AND p.replace_wanted
        ORDER BY p.replace_marked_at DESC NULLS LAST, p.id DESC`,
      [catalogue.id],
    );
    const showLocation = locationsVisible(catalogue, access);
    return {
      photos: rows.map((r) => ({
        ...out.photo(r, { showLocation, canDownloadOriginal: showLocation }),
        species: { id: r.species_id, commonName: r.common_name, scientificName: r.scientific_name, taxonSort: r.taxon_sort },
        sighting: { id: r.sighting_id, observedAt: out.iso(r.sighting_observed_at), locationName: r.sighting_location || '' },
        isCover: Boolean(r.is_cover),
        newerPhotos: r.newer_count,
        speciesPhotoCount: r.species_photo_count,
      })),
    };
  });

  /**
   * Date, place and camera from a photo, for prefilling the log form. Browsers can read these
   * themselves for most photos, but not from HEIC (iPhone) files, so the page asks here for those.
   */
  app.post('/photo-info', { config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } }, async (request) => {
    request.requireUser();
    const upload = await readUpload(request, storage, config.maxUploadMb);
    let img = null;
    try {
      img = await openImage(upload.path);
      const meta = await readImageExif(upload.path, img);
      return { localDateTime: meta.localDateTime, latitude: meta.latitude, longitude: meta.longitude, camera: meta.camera ?? '' };
    } finally {
      await img?.cleanup();
      await upload.cleanup();
    }
  });

  // ---- AI identification ------------------------------------------------------

  /**
   * Suggest species for a photo before it is saved. Results are suggestions only; the user picks.
   * Location for the prior, in order of preference: the map pin sent with the photo
   * (latitude/longitude form fields), the photo's own GPS, then the catalogue's area.
   */
  app.post(
    '/catalogues/:slug/identify',
    { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } }, schema: { params: slugParam } },
    async (request) => {
      const user = request.requireUser();
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, user);
      requireEdit(access, user);
      if (!identifier.enabled) throw new HttpError(503, 'Photo identification is not configured on this site');
      const upload = await readUpload(request, storage, config.maxUploadMb);

      let small;
      let exif;
      let preview = null;
      let img = null;
      try {
        img = await openImage(upload.path);
        // A 1024 px JPEG with no metadata: faster to score, and no GPS leaves your server.
        [small, exif] = await Promise.all([
          uprightPipeline(img)
            .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 88 })
            .toBuffer(),
          readImageExif(upload.path, img),
        ]);
        // Most browsers can't show HEIC, so send back a small JPEG for the page to show instead.
        if (img.format.ext === 'heic') {
          const jpg = await sharp(small).resize({ width: 640, height: 640, fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
          preview = `data:image/jpeg;base64,${jpg.toString('base64')}`;
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw badRequest("That file isn't an image we can read");
      } finally {
        await img?.cleanup();
        await upload.cleanup();
      }

      const pinLat = Number(upload.fields.latitude);
      const pinLng = Number(upload.fields.longitude);
      let location = null;
      if (upload.fields.latitude && Number.isFinite(pinLat) && Number.isFinite(pinLng) && Math.abs(pinLat) <= 90 && Math.abs(pinLng) <= 180) {
        location = { source: 'pin', latitude: pinLat, longitude: pinLng };
      } else if (exif.latitude !== null) {
        location = { source: 'photo', latitude: exif.latitude, longitude: exif.longitude };
      } else {
        const area = await db.one('SELECT area_latitude, area_longitude FROM catalogues WHERE id = $1', [catalogue.id]);
        if (area?.area_latitude !== null && area?.area_latitude !== undefined) {
          location = { source: 'catalogue', latitude: area.area_latitude, longitude: area.area_longitude };
        }
      }

      const pool = identifier.usesCandidates
        ? await buildCandidates({ db, ebird, catalogueId: catalogue.id, location, log: request.log })
        : null;
      if (pool && !pool.candidates.length) {
        throw badRequest('Add species to this catalogue, or set a location on the map, so there is something to compare against.');
      }

      const { model, predictions } = await identifier.identify(small, 'image/jpeg', {
        candidates: pool?.candidates.map(({ id, scientificName, commonName, order, family, prior }) => ({
          id,
          scientificName,
          commonName,
          order,
          family,
          prior,
        })),
      });

      const byId = new Map((pool?.candidates ?? []).map((c) => [c.id, c]));
      const suggestions = [];
      for (const p of predictions) {
        const cand = p.id ? byId.get(p.id) : null;
        const match = await db.one(
          `SELECT sp.id, sp.ebird_code, sp.common_name, sp.scientific_name, (cs.species_id IS NOT NULL) AS in_catalogue
             FROM species sp
             LEFT JOIN catalogue_species cs ON cs.species_id = sp.id AND cs.catalogue_id = $4
            WHERE ($1::text IS NOT NULL AND sp.ebird_code = $1)
               OR ($2::text IS NOT NULL AND lower(sp.scientific_name) = lower($2))
               OR ($1::text IS NULL AND $3::text IS NOT NULL AND lower(sp.common_name) = lower($3))
            ORDER BY (cs.species_id IS NOT NULL) DESC
            LIMIT 1`,
          [cand?.ebirdCode ?? null, p.scientificName, p.commonName, catalogue.id],
        );
        const ebirdCode = cand?.ebirdCode ?? match?.ebird_code ?? null;
        suggestions.push({
          commonName: match?.common_name ?? p.commonName,
          scientificName: match?.scientific_name ?? p.scientificName,
          ebirdCode,
          confidence: p.confidence,
          speciesId: match?.id ?? null,
          inCatalogue: Boolean(match?.in_catalogue),
          // recent = seen nearby in the last 30 days, area = recorded nearby, elsewhere = not recorded nearby
          nearby: pool?.tagFor(ebirdCode) ?? null,
        });
      }
      return {
        provider: identifier.provider,
        model,
        location: location && (pool?.summary.usedLocation ?? false) ? location : location ? { ...location, unused: true } : null,
        pool: pool?.summary ?? null,
        preview, // a small JPEG for HEIC uploads, which most browsers can't display
        suggestions,
      };
    },
  );
}

function extFor(mime) {
  return { 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/avif': 'avif', 'image/heic': 'heic' }[mime] ?? 'jpg';
}
