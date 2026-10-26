import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Photos uploaded before 0.2.0 have no fingerprint (sha256), so the duplicate warning can't spot
 * them. This fills them in from the original files, a batch at a time, in the background.
 */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/avif': 'avif', 'image/heic': 'heic' };

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export async function backfillFingerprints(db, storage, log) {
  let done = 0;
  let missing = 0;
  for (;;) {
    const batch = await db.many(
      `SELECT id, storage_key, mime_type FROM photos WHERE sha256 IS NULL AND id > $1 ORDER BY id LIMIT 200`,
      [missing],
    );
    if (!batch.length) break;
    for (const p of batch) {
      try {
        const sha = await hashFile(storage.pathOf(p.storage_key, `original.${EXT[p.mime_type] ?? 'jpg'}`));
        await db.query('UPDATE photos SET sha256 = $2 WHERE id = $1', [p.id, sha]);
        done += 1;
      } catch {
        missing = Math.max(missing, Number(p.id)); // file gone: skip it next time round
      }
    }
  }
  if (done) log?.info?.(`Fingerprinted ${done} older photos for duplicate warnings`);
  return done;
}
