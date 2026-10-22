import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createStorage } from './lib/storage.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './lib/passwords.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const log = {
  info: (msg) => console.log(`[featherkeeper] ${msg}`),
  warn: (msg) => console.warn(`[featherkeeper] ${msg}`),
};

async function waitForDatabase(attempts = 30) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      log.info(`Waiting for database (${err.code ?? err.message})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Create (or promote) the site admin named in ADMIN_EMAIL / ADMIN_PASSWORD. Never changes an existing password.
async function seedAdmin() {
  const { email, password, displayName } = config.admin;
  if (!email) return;
  const normalised = email.trim().toLowerCase();
  const existing = await db.one('SELECT id, is_site_admin FROM users WHERE email = $1', [normalised]);
  if (existing) {
    if (!existing.is_site_admin) {
      await db.query('UPDATE users SET is_site_admin = true WHERE id = $1', [existing.id]);
      log.info(`Promoted ${normalised} to site admin`);
    }
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    log.warn(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters; admin account not created`);
    return;
  }
  await db.query(
    'INSERT INTO users (email, display_name, password_hash, is_site_admin) VALUES ($1, $2, $3, true)',
    [normalised, displayName, await hashPassword(password)],
  );
  log.info(`Created site admin ${normalised}`);
}

await waitForDatabase();
await migrate(db, log);
await seedAdmin();
const storage = createStorage(config.dataDir);
await storage.ensureReady();

const app = await buildApp({ config, db, storage });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await db.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
