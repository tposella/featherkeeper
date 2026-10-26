import { statfs } from 'node:fs/promises';
import { conflict, HttpError } from './errors.js';
import { defaultQuotaMb } from './settings.js';

const MB = 1024 * 1024;

/** Catalogues a user owns, with what deleting them would remove. */
export function ownedCatalogues(db, userId) {
  return db.many(
    `SELECT c.id, c.slug, c.name,
            (SELECT count(*) FROM sightings s WHERE s.catalogue_id = c.id)::int AS sightings,
            (SELECT count(*) FROM photos p JOIN sightings s ON s.id = p.sighting_id WHERE s.catalogue_id = c.id)::int AS photos,
            (SELECT count(*) FROM catalogue_members m2 WHERE m2.catalogue_id = c.id AND m2.user_id <> $1)::int AS other_members
       FROM catalogues c JOIN catalogue_members m ON m.catalogue_id = c.id
      WHERE m.user_id = $1 AND m.role = 'owner'
      ORDER BY c.name`,
    [userId],
  );
}

/** Delete a catalogue and its photo files. */
export async function deleteCatalogue(db, storage, catalogueId, log) {
  const keys = await db.many(
    `SELECT p.storage_key FROM photos p JOIN sightings s ON s.id = p.sighting_id WHERE s.catalogue_id = $1`,
    [catalogueId],
  );
  await db.query('DELETE FROM catalogues WHERE id = $1', [catalogueId]);
  for (const { storage_key: key } of keys) {
    await storage.remove(key).catch((err) => log?.warn?.(err, 'could not delete photo files'));
  }
}

/**
 * Delete an account. Catalogues it owns are deleted with their photos (to keep one, its ownership
 * should be passed on first, in the catalogue's settings). Sightings and photos it added to other
 * people's catalogues stay, without its name. The last site admin can't be deleted.
 */
export async function deleteUser(db, storage, userId, log) {
  const user = await db.one('SELECT id, is_site_admin FROM users WHERE id = $1', [userId]);
  if (!user) return false;
  if (user.is_site_admin) {
    const { n } = await db.one('SELECT count(*)::int AS n FROM users WHERE is_site_admin');
    if (n <= 1) throw conflict('The last site admin can’t be deleted. Make someone else an admin first.', 'last_admin');
  }
  for (const c of await ownedCatalogues(db, userId)) await deleteCatalogue(db, storage, c.id, log);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  return true;
}

/** Photo storage a user is using, and their limit (0 = none). */
export async function storageFor(db, settings, config, userId) {
  const row = await db.one(
    `SELECT u.quota_mb, coalesce(sum(p.size_bytes), 0)::bigint AS used, count(p.id)::int AS photos
       FROM users u LEFT JOIN photos p ON p.uploaded_by = u.id WHERE u.id = $1 GROUP BY u.id`,
    [userId],
  );
  const quotaMb = row?.quota_mb ?? (await defaultQuotaMb(settings, config));
  return { usedBytes: Number(row?.used ?? 0), photos: row?.photos ?? 0, quotaMb, ownQuota: row?.quota_mb ?? null };
}

/** Throws 413 if adding `bytes` would take the user over their limit. */
export async function checkQuota(db, settings, config, userId, bytes) {
  const s = await storageFor(db, settings, config, userId);
  if (s.quotaMb > 0 && s.usedBytes + bytes > s.quotaMb * MB) {
    const used = Math.round(s.usedBytes / MB);
    throw new HttpError(413, `You've used ${used} MB of your ${s.quotaMb} MB photo storage. Ask the site admin for more space.`, 'quota_exceeded');
  }
}

/** Disk space where photos are stored. Null if the platform can't tell. */
export async function diskSpace(dir) {
  try {
    const s = await statfs(dir);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return null;
  }
}
