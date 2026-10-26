import { randomBytes } from 'node:crypto';
import { deleteUser, diskSpace, ownedCatalogues } from '../lib/accounts.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, MIN_PASSWORD_LENGTH, temporaryPassword } from '../lib/passwords.js';
import { defaultQuotaMb, registrationMode } from '../lib/settings.js';
import { hashInvite } from './auth.js';
import { refreshTaxonomy } from '../lib/taxonomy.js';

/**
 * Site administration: users (password resets, admins, storage limits, deleting accounts),
 * who can sign up (open, or by invite link), and disk space. There's a matching console command
 * for when the admin is the one locked out: src/admin-cli.js.
 */
const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } };

function requireSiteAdmin(request) {
  const user = request.requireUser();
  if (!user.is_site_admin) throw forbidden('Only the site admin can do that');
  return user;
}

export default async function adminRoutes(app, { db, config, settings, storage, ebird }) {
  app.get('/admin/users', async (request) => {
    requireSiteAdmin(request);
    const rows = await db.many(
      `SELECT u.id, u.email, u.display_name, u.is_site_admin, u.created_at, u.quota_mb,
              (SELECT count(*) FROM catalogue_members m WHERE m.user_id = u.id)::int AS catalogues,
              (SELECT count(*) FROM catalogue_members m WHERE m.user_id = u.id AND m.role = 'owner')::int AS owned,
              (SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in,
              (SELECT count(*) FROM photos p WHERE p.uploaded_by = u.id)::int AS photos,
              (SELECT coalesce(sum(p.size_bytes), 0) FROM photos p WHERE p.uploaded_by = u.id)::bigint AS used_bytes
         FROM users u ORDER BY u.created_at`,
    );
    const siteQuota = await defaultQuotaMb(settings, config);
    return {
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        isSiteAdmin: r.is_site_admin,
        createdAt: r.created_at?.toISOString() ?? null,
        lastSignIn: r.last_sign_in?.toISOString() ?? null,
        catalogues: r.catalogues,
        ownedCatalogues: r.owned,
        photos: r.photos,
        usedBytes: Number(r.used_bytes),
        // Their own limit, if set; otherwise the site default applies.
        quotaMb: r.quota_mb,
        effectiveQuotaMb: r.quota_mb ?? siteQuota,
      })),
    };
  });

  /**
   * Reset a user's password: to one the admin typed, or to a generated temporary one, which is
   * returned once so the admin can pass it on. The user is signed out everywhere.
   */
  app.post(
    '/admin/users/:id/reset-password',
    {
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
      schema: {
        params: idParam,
        body: {
          type: ['object', 'null'],
          properties: { password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 } },
        },
      },
    },
    async (request) => {
      requireSiteAdmin(request);
      const target = await db.one('SELECT id, email FROM users WHERE id = $1', [request.params.id]);
      if (!target) throw notFound('No such user');
      const typed = request.body?.password;
      const password = typed ?? temporaryPassword();
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [target.id, await hashPassword(password)]);
      // Sign them out everywhere (but don't sign the admin out of this browser if it's their own account).
      await db.query('DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2', [target.id, request.sessionId]);
      return { email: target.email, password: typed ? null : password, generated: !typed };
    },
  );

  /** Make someone a site admin (or not), or set their photo storage limit (null = the site default). */
  app.patch(
    '/admin/users/:id',
    {
      schema: {
        params: idParam,
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            isSiteAdmin: { type: 'boolean' },
            quotaMb: { type: ['integer', 'null'], minimum: 0, maximum: 100000000 },
          },
        },
      },
    },
    async (request) => {
      requireSiteAdmin(request);
      const b = request.body;
      const target = await db.one('SELECT id, is_site_admin FROM users WHERE id = $1', [request.params.id]);
      if (!target) throw notFound('No such user');
      if ('isSiteAdmin' in b) {
        if (target.is_site_admin && !b.isSiteAdmin) {
          const { n } = await db.one('SELECT count(*)::int AS n FROM users WHERE is_site_admin');
          if (n <= 1) throw conflict('The site needs at least one admin', 'last_admin');
        }
        await db.query('UPDATE users SET is_site_admin = $2 WHERE id = $1', [target.id, b.isSiteAdmin]);
      }
      if ('quotaMb' in b) await db.query('UPDATE users SET quota_mb = $2 WHERE id = $1', [target.id, b.quotaMb]);
      return { ok: true };
    },
  );

  /** What deleting a user would remove (for the confirmation). */
  app.get('/admin/users/:id/owned', { schema: { params: idParam } }, async (request) => {
    requireSiteAdmin(request);
    const owned = await ownedCatalogues(db, request.params.id);
    return { catalogues: owned.map((c) => ({ slug: c.slug, name: c.name, sightings: c.sightings, photos: c.photos, otherMembers: c.other_members })) };
  });

  /** Delete an account, and the catalogues it owns. Admins delete their own account from Account instead. */
  app.delete('/admin/users/:id', { schema: { params: idParam } }, async (request) => {
    const admin = requireSiteAdmin(request);
    if (request.params.id === Number(admin.id)) throw badRequest('Delete your own account from the Account page');
    const ok = await deleteUser(db, storage, request.params.id, request.log);
    if (!ok) throw notFound('No such user');
    return { ok: true };
  });

  // ---- Site settings --------------------------------------------------------------

  app.get('/admin/settings', async (request) => {
    requireSiteAdmin(request);
    const [registration, quota, disk, photoBytes, taxonomy] = await Promise.all([
      registrationMode(settings, config),
      defaultQuotaMb(settings, config),
      diskSpace(storage.root),
      db.one('SELECT coalesce(sum(size_bytes), 0)::bigint AS n, count(*)::int AS photos FROM photos'),
      settings.get('taxonomy'),
    ]);
    return {
      registration,
      defaultQuotaMb: quota,
      disk: disk && { ...disk, photosBytes: Number(photoBytes.n), photos: photoBytes.photos },
      taxonomy: { ebirdEnabled: ebird.enabled, last: taxonomy },
    };
  });

  app.patch(
    '/admin/settings',
    {
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            registration: { type: 'string', enum: ['open', 'invite'] },
            defaultQuotaMb: { type: 'integer', minimum: 0, maximum: 100000000 },
          },
        },
      },
    },
    async (request) => {
      requireSiteAdmin(request);
      if (request.body.registration) await settings.set('registration', request.body.registration);
      if (request.body.defaultQuotaMb !== undefined) await settings.set('default_quota_mb', request.body.defaultQuotaMb);
      return { ok: true };
    },
  );

  /** Update species names from eBird's current taxonomy now (it also runs by itself monthly). */
  app.post('/admin/taxonomy/refresh', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    requireSiteAdmin(request);
    if (!ebird.enabled) throw badRequest('Set EBIRD_API_KEY to refresh species from eBird');
    return refreshTaxonomy({ db, ebird, settings, log: request.log });
  });

  // ---- Invites ---------------------------------------------------------------------

  app.get('/admin/invites', async (request) => {
    requireSiteAdmin(request);
    const rows = await db.many(
      `SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, u.display_name AS used_by_name, u.email AS used_by_email
         FROM invites i LEFT JOIN users u ON u.id = i.used_by
        WHERE i.used_at IS NULL OR i.used_at > now() - interval '30 days'
        ORDER BY i.created_at DESC LIMIT 100`,
    );
    return {
      invites: rows.map((r) => ({
        id: r.id,
        note: r.note,
        createdAt: r.created_at.toISOString(),
        expiresAt: r.expires_at.toISOString(),
        usedAt: r.used_at?.toISOString() ?? null,
        usedBy: r.used_by_name ? `${r.used_by_name} (${r.used_by_email})` : null,
        expired: !r.used_at && r.expires_at < new Date(),
      })),
    };
  });

  /** A new invite link. The link is only shown now; the site keeps a hash of it. */
  app.post(
    '/admin/invites',
    {
      config: { rateLimit: { max: 60, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          properties: { note: { type: 'string', maxLength: 200 }, days: { type: 'integer', minimum: 1, maximum: 30 } },
        },
      },
    },
    async (request) => {
      const admin = requireSiteAdmin(request);
      const token = randomBytes(24).toString('base64url');
      const days = request.body.days ?? 7;
      const row = await db.one(
        `INSERT INTO invites (token_hash, note, created_by, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING id, expires_at`,
        [hashInvite(token), (request.body.note ?? '').trim(), admin.id, days],
      );
      return { id: row.id, url: `${config.publicUrl}/register?invite=${token}`, token, expiresAt: row.expires_at.toISOString() };
    },
  );

  app.delete('/admin/invites/:id', { schema: { params: idParam } }, async (request) => {
    requireSiteAdmin(request);
    await db.query('DELETE FROM invites WHERE id = $1 AND used_at IS NULL', [request.params.id]);
    return { ok: true };
  });
}
