/**
 * Site settings stored in the database (site_settings), changed by the admin in the app.
 * Read often, written rarely, so values are cached in memory for a few seconds.
 */
const TTL_MS = 5000;

export function createSettings(db) {
  const cache = new Map();
  return {
    async get(key, fallback = null) {
      const hit = cache.get(key);
      if (hit && hit.at > Date.now() - TTL_MS) return hit.value ?? fallback;
      const row = await db.one('SELECT value FROM site_settings WHERE key = $1', [key]);
      const value = row ? row.value : null;
      cache.set(key, { value, at: Date.now() });
      return value ?? fallback;
    },
    async set(key, value) {
      await db.query(
        `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
      cache.set(key, { value, at: Date.now() });
    },
  };
}

/**
 * Who can create an account: "open" (anyone) or "invite" (only with an invite link from the admin).
 * Until the admin chooses, ALLOW_REGISTRATION in .env decides (true = open). The very first account
 * on a new site can always be created; it becomes the site admin.
 */
export async function registrationMode(settings, config) {
  const chosen = await settings.get('registration');
  if (chosen === 'open' || chosen === 'invite') return chosen;
  return config.allowRegistration ? 'open' : 'invite';
}

/** The default storage limit for photos, in MB (0 = no limit). */
export async function defaultQuotaMb(settings, config) {
  const v = await settings.get('default_quota_mb');
  return Number.isInteger(v) && v >= 0 ? v : config.defaultQuotaMb;
}
