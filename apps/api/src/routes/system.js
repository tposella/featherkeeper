import { registrationMode } from '../lib/settings.js';
import { VERSION as version } from '../lib/version.js';

export default async function systemRoutes(app, { db, config, ebird, geocoder, identifier, reference, sounds, updates, settings }) {
  // Used by Docker health checks and uptime monitors.
  app.get('/health', async (request, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok', version };
    } catch {
      return reply.code(503).send({ status: 'database_unavailable' });
    }
  });

  // Public settings the frontend needs before anyone signs in.
  app.get('/config', async () => {
    const { count } = await db.one('SELECT count(*)::int AS count FROM users');
    const registration = await registrationMode(settings, config);
    return {
      version,
      // "open": anyone can sign up; "invite": only with an invite link (the first account always can).
      registration: count === 0 ? 'open' : registration,
      allowRegistration: registration === 'open' || count === 0,
      needsSetup: count === 0,
      maxUploadMb: config.maxUploadMb,
      ebirdEnabled: ebird.enabled,
      placeSearchEnabled: geocoder.enabled,
      referencePhotosEnabled: reference.enabled,
      soundsEnabled: sounds.enabled,
      identifyEnabled: identifier.enabled,
    };
  });

  /**
   * The running version, and whether a newer release is out. Everyone sees the version; the
   * details of an available update are for site admins, who are the ones who can install it.
   * ?refresh=1 (admins only) checks GitHub again straight away.
   */
  app.get(
    '/version',
    { schema: { querystring: { type: 'object', properties: { refresh: { type: 'integer', enum: [0, 1] } } } } },
    async (request) => {
      const admin = Boolean(request.user?.is_site_admin);
      if (!admin) return { current: version, admin: false };
      const status = await updates.status({ force: request.query.refresh === 1 });
      return {
        admin: true,
        ...status,
        repo: updates.repo,
        releasesUrl: `https://github.com/${updates.repo}/releases`,
      };
    },
  );
}
