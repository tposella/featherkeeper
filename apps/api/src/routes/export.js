import { loadCatalogue, requireEdit } from '../lib/access.js';
import { createZip } from '../lib/zip.js';
import { DEX_SQL, dexEntry } from './dex.js';

/**
 * Download a whole catalogue as a ZIP: spreadsheets (CSV) of the species checklist, sightings and
 * photos, plus every original photo file, in folders by species. For the owner and editors, since
 * originals carry GPS. Streamed, so a large catalogue never sits in memory.
 */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/avif': 'avif', 'image/heic': 'heic' };

/** One CSV row: quoted where needed, and guarded against spreadsheet formula injection. */
function csvRow(values) {
  return values
    .map((v) => {
      if (v === null || v === undefined) return '';
      let s = v instanceof Date ? v.toISOString() : String(v);
      if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
// A byte-order mark so Excel opens the files as UTF-8 (accents in names and notes).
const csv = (header, rows) => Buffer.from(`﻿${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`, 'utf8');

/** Safe file and folder names for every OS. */
const safe = (s) =>
  String(s ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'unnamed';

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'undated');

export default async function exportRoutes(app, { db, storage }) {
  app.get(
    '/catalogues/:slug/export.zip',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: { params: { type: 'object', required: ['slug'], properties: { slug: { type: 'string', maxLength: 64 } } } },
    },
    async (request, reply) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      requireEdit(access, request.user);

      const dex = (await db.many(`${DEX_SQL} ORDER BY sp.taxon_sort NULLS LAST, sp.common_name`, [catalogue.id])).map(dexEntry);
      const plates = new Map(dex.map((d, i) => [d.id, i + 1]));
      const speciesById = new Map(dex.map((d) => [d.id, d]));
      const sightings = await db.many(
        `SELECT s.*, u.display_name AS logged_by FROM sightings s LEFT JOIN users u ON u.id = s.created_by
          WHERE s.catalogue_id = $1 ORDER BY s.observed_at NULLS LAST, s.id`,
        [catalogue.id],
      );
      const photos = await db.many(
        `SELECT p.* FROM photos p JOIN sightings s ON s.id = p.sighting_id
          WHERE s.catalogue_id = $1 ORDER BY p.taken_at NULLS LAST, p.id`,
        [catalogue.id],
      );
      const sightingById = new Map(sightings.map((s) => [s.id, s]));

      // Where each photo goes in the ZIP: photos/<plate> <Common Name>/<date> <photo id>.<ext>
      const folder = (speciesId) => {
        const sp = speciesById.get(speciesId);
        const plate = String(plates.get(speciesId) ?? 0).padStart(3, '0');
        return `photos/${plate} ${safe(sp?.commonName ?? 'Unknown species')}`;
      };
      const fileFor = new Map(
        photos.map((p) => {
          const s = sightingById.get(p.sighting_id);
          return [p.id, `${folder(s.species_id)}/${day(p.taken_at ?? s.observed_at)} ${p.id}.${EXT[p.mime_type] ?? 'jpg'}`];
        }),
      );

      const stamp = new Date().toISOString().slice(0, 10);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="featherkeeper-${catalogue.slug}-${stamp}.zip"`);
      reply.header('Cache-Control', 'no-store');
      // Tell nginx (ours and yours) to pass the download straight through rather than spooling it
      // to a temporary file first, which for a big catalogue could fill the disk.
      reply.header('X-Accel-Buffering', 'no');
      const zip = createZip();
      reply.send(zip.stream);

      // Fill the ZIP after the response has started; a failure part-way ends the download with an error.
      (async () => {
        await zip.addBuffer(
          'README.txt',
          Buffer.from(
            [
              `Featherkeeper export: ${catalogue.name}`,
              `Exported ${new Date().toISOString()} by ${request.user.display_name}.`,
              '',
              'species.csv    the checklist, in field-guide order, with what you have photographed',
              'sightings.csv  every sighting, with its date, place, notes and photo files',
              'photos.csv     every photo, with its camera details, GPS and to-replace notes',
              'photos/        the original photo files, byte for byte, in a folder per species',
              '',
              'Dates are UTC (ISO 8601). The CSV files are UTF-8 and open in Excel, Numbers and Google Sheets.',
              '',
            ].join('\r\n'),
            'utf8',
          ),
        );

        await zip.addBuffer(
          'species.csv',
          csv(
            ['plate', 'common_name', 'scientific_name', 'family', 'order', 'ebird_code', 'status', 'photos', 'sightings', 'first_seen', 'last_seen', 'notes'],
            dex.map((d) => [
              plates.get(d.id),
              d.commonName,
              d.scientificName,
              d.familyCommon || d.familyScientific,
              d.taxonOrder,
              d.ebirdCode,
              d.status,
              d.photoCount,
              d.sightingCount,
              d.firstObserved,
              d.lastObserved,
              d.notes,
            ]),
          ),
        );

        await zip.addBuffer(
          'sightings.csv',
          csv(
            ['sighting_id', 'plate', 'common_name', 'scientific_name', 'observed_at', 'location_name', 'latitude', 'longitude', 'notes', 'logged_by', 'photo_files'],
            sightings.map((s) => {
              const sp = speciesById.get(s.species_id);
              return [
                s.id,
                plates.get(s.species_id),
                sp?.commonName,
                sp?.scientificName,
                s.observed_at,
                s.location_name,
                s.latitude,
                s.longitude,
                s.notes,
                s.logged_by,
                photos
                  .filter((p) => p.sighting_id === s.id)
                  .map((p) => fileFor.get(p.id))
                  .join('; '),
              ];
            }),
          ),
        );

        await zip.addBuffer(
          'photos.csv',
          csv(
            ['photo_id', 'sighting_id', 'common_name', 'file', 'original_name', 'taken_at', 'camera', 'lens', 'latitude', 'longitude', 'width', 'height', 'size_bytes', 'is_thumbnail', 'to_replace', 'replace_note'],
            photos.map((p) => {
              const s = sightingById.get(p.sighting_id);
              const sp = speciesById.get(s.species_id);
              return [
                p.id,
                p.sighting_id,
                sp?.commonName,
                fileFor.get(p.id),
                p.original_name,
                p.taken_at,
                p.camera,
                p.lens,
                p.latitude,
                p.longitude,
                p.width,
                p.height,
                p.size_bytes,
                sp?.coverPhotoId === p.id ? 'yes' : '',
                p.replace_wanted ? 'yes' : '',
                p.replace_note,
              ];
            }),
          ),
        );

        for (const p of photos) {
          const name = `original.${EXT[p.mime_type] ?? 'jpg'}`;
          const file = storage.pathOf(p.storage_key, name);
          try {
            await zip.addFile(fileFor.get(p.id), file, p.taken_at ?? p.created_at);
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            request.log.warn({ photoId: p.id }, 'export: original file missing, skipped');
          }
        }
        await zip.finish();
      })().catch((err) => {
        request.log.error(err, 'export failed part-way');
        zip.stream.destroy(err);
      });
      return reply;
    },
  );
}
