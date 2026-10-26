// All runtime settings come from environment variables. See .env.example at the repo root.

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Which proxies may tell us the visitor's address (X-Forwarded-For). By default only proxies on
 * private networks: the web container, your own nginx, cloudflared and Docker are all on one, so
 * the real visitor address comes through, but an address a visitor makes up in that header is
 * ignored (otherwise they could dodge the login rate limit). TRUST_PROXY can also be "false",
 * a number of proxy hops, or a list of addresses or CIDR ranges. "true" (trust any) is
 * treated like the default, since trusting every address would let visitors fake theirs.
 */
export const PRIVATE_PROXIES = ['loopback', 'linklocal', 'uniquelocal'];
function trustProxy(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || ['true', 'yes', '1', 'on', 'private'].includes(v)) return PRIVATE_PROXIES;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  if (/^\d+$/.test(v)) return Number(v);
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function databaseUrl(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = encodeURIComponent(env.POSTGRES_USER ?? 'featherkeeper');
  const pass = encodeURIComponent(env.POSTGRES_PASSWORD ?? 'featherkeeper');
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5432';
  const db = env.POSTGRES_DB ?? 'featherkeeper';
  return `postgres://${user}:${pass}@${host}:${port}/${db}`;
}

export function loadConfig(env = process.env) {
  const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
  const identifyProvider = (env.IDENTIFY_PROVIDER ?? 'none').toLowerCase();

  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: databaseUrl(env),
    dataDir: env.DATA_DIR ?? './data',
    publicUrl,
    // Secure cookies need HTTPS between the browser and your proxy. Defaults to on when PUBLIC_URL is https.
    cookieSecure: bool(env.COOKIE_SECURE, publicUrl.startsWith('https://')),
    // Trust X-Forwarded-* headers from the reverse proxy in front of the stack.
    trustProxy: trustProxy(env.TRUST_PROXY),
    sessionDays: int(env.SESSION_DAYS, 30),
    // Until the admin picks a sign-up mode in the app: true = anyone can register, false = invite only.
    allowRegistration: bool(env.ALLOW_REGISTRATION, false),
    // Default photo storage limit per user, in MB (0 = none); the admin can change it in the app.
    defaultQuotaMb: Math.max(0, int(env.DEFAULT_QUOTA_MB, 0)),
    admin: {
      email: env.ADMIN_EMAIL ?? '',
      password: env.ADMIN_PASSWORD ?? '',
      displayName: env.ADMIN_NAME ?? 'Admin',
    },
    // Largest photo upload in MB; 0 means no limit. 100 matches Cloudflare's free-plan request limit.
    maxUploadMb: Math.max(0, int(env.MAX_UPLOAD_MB, 100)),
    ebird: {
      apiKey: env.EBIRD_API_KEY ?? '',
      baseUrl: env.EBIRD_BASE_URL ?? 'https://api.ebird.org/v2',
    },
    geocoder: {
      url: env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org',
      userAgent: `Featherkeeper/0.1 (+${publicUrl})`,
    },
    // Example photos of suggested species, from iNaturalist and Wikipedia.
    reference: {
      enabled: bool(env.REFERENCE_PHOTOS, true),
      userAgent: `Featherkeeper/0.1 (+${publicUrl})`,
    },
    // "In season" and "when and where to find it": iNaturalist counts and Wikipedia habitat text.
    insights: {
      enabled: bool(env.SPECIES_INSIGHTS, true),
      userAgent: `Featherkeeper/0.1 (+${publicUrl})`,
    },
    // Tell the site admin when a newer release is published on GitHub.
    updates: {
      enabled: bool(env.UPDATE_CHECK, true),
      repo: env.UPDATE_CHECK_REPO ?? 'tposella/featherkeeper',
      userAgent: `Featherkeeper (+${publicUrl})`,
    },
    // "Calls and songs": iNaturalist by default; xeno-canto too when a key is set.
    sounds: {
      enabled: bool(env.SPECIES_SOUNDS, true),
      userAgent: `Featherkeeper/0.1 (+${publicUrl})`,
      xenoCantoKey: env.XENO_CANTO_API_KEY ?? '',
    },
    identify: {
      provider: identifyProvider,
      url: env.IDENTIFY_URL ?? '',
      apiKey: env.IDENTIFY_API_KEY ?? '',
      // The first identification encodes every candidate name, which takes a while on CPU.
      timeoutMs: int(env.IDENTIFY_TIMEOUT_MS, 180000),
    },
  };
}
