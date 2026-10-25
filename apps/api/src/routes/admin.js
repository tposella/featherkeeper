import { forbidden, notFound, conflict } from '../lib/errors.js';
import { hashPassword, MIN_PASSWORD_LENGTH, temporaryPassword } from '../lib/passwords.js';

/**
 * Site administration: the user list, resetting a user's password (there's no email on this
 * site, so a forgotten password is reset by the admin), and choosing who else is a site admin.
 * There's a matching console command for when the admin is the one locked out: src/admin-cli.js.
 */
const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } };

function requireSiteAdmin(request) {
  const user = request.requireUser();
  if (!user.is_site_admin) throw forbidden('Only the site admin can do that');
  return user;
}

export default async function adminRoutes(app, { db }) {
  app.get('/admin/users', async (request) => {
    requireSiteAdmin(request);
    const rows = await db.many(
      `SELECT u.id, u.email, u.display_name, u.is_site_admin, u.created_at,
              (SELECT count(*) FROM catalogue_members m WHERE m.user_id = u.id)::int AS catalogues,
              (SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in
         FROM users u ORDER BY u.created_at`,
    );
    return {
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        isSiteAdmin: r.is_site_admin,
        createdAt: r.created_at?.toISOString() ?? null,
        lastSignIn: r.last_sign_in?.toISOString() ?? null,
        catalogues: r.catalogues,
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

  app.patch(
    '/admin/users/:id',
    {
      schema: {
        params: idParam,
        body: { type: 'object', required: ['isSiteAdmin'], properties: { isSiteAdmin: { type: 'boolean' } } },
      },
    },
    async (request) => {
      requireSiteAdmin(request);
      const target = await db.one('SELECT id, is_site_admin FROM users WHERE id = $1', [request.params.id]);
      if (!target) throw notFound('No such user');
      if (target.is_site_admin && !request.body.isSiteAdmin) {
        const { n } = await db.one('SELECT count(*)::int AS n FROM users WHERE is_site_admin');
        if (n <= 1) throw conflict('The site needs at least one admin', 'last_admin');
      }
      await db.query('UPDATE users SET is_site_admin = $2 WHERE id = $1', [target.id, request.body.isSiteAdmin]);
      return { ok: true };
    },
  );
}
