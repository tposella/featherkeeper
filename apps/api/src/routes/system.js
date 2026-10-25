import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
// Release images carry their version (e.g. 0.1.0-beta.1); local builds fall back to package.json.
const version = process.env.FEATHERKEEPER_VERSION && process.env.FEATHERKEEPER_VERSION !== 'dev' ? process.env.FEATHERKEEPER_VERSION : pkg.version;

export default async function systemRoutes(app, { db, config, ebird, geocoder, identifier, reference, sounds }) {
  // Used by Docker health checks and uptime monitors.
  app.get('/health', async (request, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'database_unavailable' });
    }
  });

  // Public settings the frontend needs before anyone signs in.
  app.get('/config', async () => {
    const { count } = await db.one('SELECT count(*)::int AS count FROM users');
    return {
      version,
      allowRegistration: config.allowRegistration || count === 0,
      needsSetup: count === 0,
      maxUploadMb: config.maxUploadMb,
      ebirdEnabled: ebird.enabled,
      placeSearchEnabled: geocoder.enabled,
      referencePhotosEnabled: reference.enabled,
      soundsEnabled: sounds.enabled,
      identifyEnabled: identifier.enabled,
    };
  });
}
