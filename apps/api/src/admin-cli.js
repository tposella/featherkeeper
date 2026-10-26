// Featherkeeper admin commands, run on the server:
//
//   docker compose exec api node src/admin-cli.js list-users
//   docker compose exec api node src/admin-cli.js reset-password you@example.com
//   docker compose exec api node src/admin-cli.js reset-password you@example.com --password "a new password"
//   docker compose exec api node src/admin-cli.js make-admin you@example.com
//   docker compose exec api node src/admin-cli.js fix-photo-times --timezone America/Vancouver [--dry-run]
//
// reset-password prints a temporary password (unless you give one) and signs that user out everywhere.
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { hashPassword, MIN_PASSWORD_LENGTH, temporaryPassword } from './lib/passwords.js';
import { isTimeZone, openImage, readImageExif } from './lib/images.js';
import { createStorage } from './lib/storage.js';

const [command, ...args] = process.argv.slice(2);
const email = args[0]?.startsWith('--') ? undefined : args[0];
const rest = args;
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  if (i >= 0) return rest[i + 1];
  const eq = rest.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};

const USAGE = `Usage:
  node src/admin-cli.js list-users
  node src/admin-cli.js reset-password <email> [--password <new password>]
  node src/admin-cli.js make-admin <email>
  node src/admin-cli.js fix-photo-times --timezone <Area/City> [--dry-run]`;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/avif': 'avif', 'image/heic': 'heic' };

/**
 * Before 0.1.2, photo times from cameras that don't record a time zone were read as UTC. This
 * re-reads each original's EXIF with the right time zone and corrects the photo's time, and its
 * sighting's date when that had been filled in from the photo.
 */
async function fixPhotoTimes(db, config, timeZone, dryRun) {
  const storage = createStorage(config.dataDir);
  const photos = await db.many(
    `SELECT p.id, p.storage_key, p.mime_type, p.taken_at, p.sighting_id, s.observed_at
       FROM photos p JOIN sightings s ON s.id = p.sighting_id WHERE p.taken_at IS NOT NULL ORDER BY p.id`,
  );
  let changed = 0;
  let sightings = 0;
  for (const p of photos) {
    const file = storage.pathOf(p.storage_key, `original.${EXT[p.mime_type] ?? 'jpg'}`);
    let img = null;
    try {
      img = await openImage(file);
      const meta = await readImageExif(file, img, { timeZone });
      if (!meta.takenAt || new Date(meta.takenAt).getTime() === new Date(p.taken_at).getTime()) continue;
      changed += 1;
      const fillSighting = p.observed_at && new Date(p.observed_at).getTime() === new Date(p.taken_at).getTime();
      console.log(`photo ${p.id}: ${new Date(p.taken_at).toISOString()} -> ${meta.takenAt}${fillSighting ? ' (and its sighting)' : ''}`);
      if (dryRun) continue;
      await db.query('UPDATE photos SET taken_at = $2 WHERE id = $1', [p.id, meta.takenAt]);
      if (fillSighting) {
        await db.query('UPDATE sightings SET observed_at = $2, updated_at = now() WHERE id = $1 AND observed_at = $3', [
          p.sighting_id,
          meta.takenAt,
          p.taken_at,
        ]);
        sightings += 1;
      }
    } catch (err) {
      console.log(`photo ${p.id}: skipped (${err.message})`);
    } finally {
      await img?.cleanup();
    }
  }
  console.log(
    dryRun
      ? `${changed} of ${photos.length} photos would change. Run again without --dry-run to apply.`
      : `Corrected ${changed} of ${photos.length} photos and ${sightings} sightings.`,
  );
}

async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  try {
    if (command === 'list-users') {
      const rows = await db.many('SELECT email, display_name, is_site_admin, created_at FROM users ORDER BY created_at');
      if (!rows.length) console.log('No users yet. The first account created becomes the site admin.');
      for (const r of rows) console.log(`${r.is_site_admin ? 'admin ' : '      '} ${r.email}  (${r.display_name})`);
      return 0;
    }

    if (command === 'fix-photo-times') {
      const timeZone = flag('timezone');
      if (!isTimeZone(timeZone)) {
        console.error('Give your time zone, e.g. --timezone America/Vancouver (see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).');
        return 2;
      }
      await fixPhotoTimes(db, config, timeZone, rest.includes('--dry-run'));
      return 0;
    }

    if (!email) {
      console.error(USAGE);
      return 2;
    }
    const user = await db.one('SELECT id, email FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (!user) {
      console.error(`No user with the email ${email}. Run "list-users" to see them.`);
      return 1;
    }

    if (command === 'reset-password') {
      const typed = flag('password');
      if (typed !== undefined && typed.length < MIN_PASSWORD_LENGTH) {
        console.error(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return 2;
      }
      const password = typed ?? temporaryPassword();
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(password)]);
      await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      console.log(`Password reset for ${user.email}. They've been signed out everywhere.`);
      if (!typed) {
        console.log(`Temporary password: ${password}`);
        console.log('Sign in with it, then change it under Account.');
      }
      return 0;
    }

    if (command === 'make-admin') {
      await db.query('UPDATE users SET is_site_admin = true WHERE id = $1', [user.id]);
      console.log(`${user.email} is now a site admin.`);
      return 0;
    }

    console.error(`Unknown command "${command}".\n${USAGE}`);
    return 2;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
