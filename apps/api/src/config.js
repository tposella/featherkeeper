// All runtime settings come from environment variables. See .env.example at the repo root.

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
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
    trustProxy: bool(env.TRUST_PROXY, true),
    sessionDays: int(env.SESSION_DAYS, 30),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
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
    identify: {
      provider: identifyProvider,
      url: env.IDENTIFY_URL ?? '',
      apiKey: env.IDENTIFY_API_KEY ?? '',
      timeoutMs: int(env.IDENTIFY_TIMEOUT_MS, 30000),
    },
  };
}
