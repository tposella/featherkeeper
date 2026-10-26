import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { createEbirdClient } from './integrations/ebird.js';
import { createGeocoder } from './integrations/geocode.js';
import { createInaturalistClient } from './integrations/inat.js';
import { createReferenceClient } from './integrations/reference.js';
import { createSoundsClient } from './integrations/sounds.js';
import { createUpdateChecker } from './integrations/updates.js';
import { VERSION } from './lib/version.js';
import { createWikipediaClient } from './integrations/wikipedia.js';
import { createIdentifier } from './integrations/identify.js';
import { createExamples } from './lib/examples.js';
import { createStorage } from './lib/storage.js';
import { authPlugin } from './plugins/auth.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import catalogueRoutes from './routes/catalogues.js';
import dexRoutes from './routes/dex.js';
import ebirdRoutes from './routes/ebird.js';
import exportRoutes from './routes/export.js';
import referenceRoutes from './routes/reference.js';
import seasonRoutes from './routes/season.js';
import sightingRoutes from './routes/sightings.js';
import systemRoutes from './routes/system.js';

/**
 * Build the Fastify app. Dependencies can be passed in (tests swap the eBird
 * client and the identifier for fakes); anything missing is created from config.
 */
export async function buildApp({
  config,
  db,
  storage,
  ebird,
  geocoder,
  identifier,
  reference,
  inat,
  wikipedia,
  sounds,
  examples,
  updates,
  logger,
}) {
  const deps = {
    config,
    db,
    storage: storage ?? createStorage(config.dataDir),
    ebird: ebird ?? createEbirdClient(config.ebird),
    geocoder: geocoder ?? createGeocoder(config.geocoder),
    reference: reference ?? createReferenceClient(config.reference),
    inat: inat ?? createInaturalistClient(config.insights),
    wikipedia: wikipedia ?? createWikipediaClient(config.insights),
    sounds: sounds ?? createSoundsClient(config.sounds),
    identifier: identifier ?? createIdentifier(config.identify),
    updates: updates ?? createUpdateChecker({ ...config.updates, currentVersion: VERSION }),
  };

  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  // Example photos for the dex's greyed view, fetched in the background and stored in the database.
  deps.examples =
    examples ?? createExamples({ db, reference: deps.reference, userAgent: config.reference.userAgent, log: app.log });

  // Once the server is listening, start fetching any example photos still missing (e.g. after an upgrade).
  app.addHook('onListen', async () => {
    deps.examples
      .prepare()
      .then((n) => n && app.log.info(`Fetching example photos for ${n} species in the background`))
      .catch((err) => app.log.warn({ err: err.message }, 'could not queue example photos'));
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadMb > 0 ? config.maxUploadMb * 1024 * 1024 : Number.POSITIVE_INFINITY,
      files: 1,
      fields: 10,
    },
  });
  await app.register(authPlugin, deps);

  app.setErrorHandler((err, request, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(413)
        .send({ error: 'too_large', message: `Photos can be at most ${config.maxUploadMb} MB` });
    }
    if (err.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      return reply.code(415).send({ error: 'unsupported_media_type', message: 'Send the photo as multipart/form-data' });
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) request.log.error(err);
    return reply.code(status).send({
      error: typeof err.code === 'string' && status < 500 ? err.code.toLowerCase() : 'server_error',
      message: status >= 500 && !(err.code && err.statusCode) ? 'Something went wrong on the server' : err.message,
    });
  });

  await app.register(
    async (api) => {
      api.setNotFoundHandler((request, reply) => reply.code(404).send({ error: 'not_found', message: 'No such API route' }));
      await api.register(systemRoutes, deps);
      await api.register(authRoutes, deps);
      await api.register(adminRoutes, deps);
      await api.register(catalogueRoutes, deps);
      await api.register(dexRoutes, deps);
      await api.register(ebirdRoutes, deps);
      await api.register(exportRoutes, deps);
      await api.register(referenceRoutes, deps);
      await api.register(seasonRoutes, deps);
      await api.register(sightingRoutes, deps);
    },
    { prefix: '/api' },
  );

  return app;
}
