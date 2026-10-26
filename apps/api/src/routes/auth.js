import { createHash } from 'node:crypto';
import { deleteUser, ownedCatalogues, storageFor } from '../lib/accounts.js';
import { badRequest, conflict, HttpError, isUniqueViolation } from '../lib/errors.js';
import { registrationMode } from '../lib/settings.js';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../lib/passwords.js';
import * as out from '../lib/serialize.js';

const AUTH_RATE_LIMIT = { max: 10, timeWindow: '15 minutes' };

// Run on unknown emails so a failed login takes as long either way.
const DUMMY_HASH = await hashPassword('not-a-real-password');

const email = { type: 'string', format: 'email', maxLength: 254 };
const password = { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 };
const displayName = { type: 'string', minLength: 1, maxLength: 80 };

/** Invite tokens are stored hashed, like session tokens. */
export const hashInvite = (token) => createHash('sha256').update(String(token)).digest('hex');

export default async function authRoutes(app, { db, config, settings, storage }) {
  // Whether an invite link is still good (for the sign-up page to say so before the form is filled in).
  app.get(
    '/auth/invite/:token',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { params: { type: 'object', required: ['token'], properties: { token: { type: 'string', maxLength: 200 } } } },
    },
    async (request) => {
      const row = await db.one(
        'SELECT expires_at, used_at FROM invites WHERE token_hash = $1',
        [hashInvite(request.params.token)],
      );
      if (!row) return { valid: false, reason: 'not_found' };
      if (row.used_at) return { valid: false, reason: 'used' };
      if (row.expires_at < new Date()) return { valid: false, reason: 'expired' };
      return { valid: true, expiresAt: row.expires_at.toISOString() };
    },
  );

  app.post(
    '/auth/register',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password', 'displayName'],
          properties: { email, password, displayName, invite: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const { count } = await db.one('SELECT count(*)::int AS count FROM users');
      const firstUser = count === 0;
      const mode = await registrationMode(settings, config);
      const inviteHash = request.body.invite ? hashInvite(request.body.invite) : null;
      if (!firstUser && mode !== 'open' && !inviteHash) {
        throw new HttpError(403, 'Sign-ups on this site are by invitation. Ask the site admin for an invite link.', 'invite_required');
      }

      const name = request.body.displayName.trim();
      if (!name) throw badRequest('Display name is required');
      const passwordHash = await hashPassword(request.body.password);
      let row;
      try {
        row = await db.tx(async (t) => {
          const user = await t.one(
            `INSERT INTO users (email, display_name, password_hash, is_site_admin)
             VALUES ($1, $2, $3, $4)
             RETURNING id, email, display_name, is_site_admin`,
            [request.body.email.trim().toLowerCase(), name, passwordHash, firstUser],
          );
          // Use up the invite in the same transaction, so one link makes one account.
          if (!firstUser && mode !== 'open') {
            const used = await t.one(
              `UPDATE invites SET used_by = $2, used_at = now()
                WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING id`,
              [inviteHash, user.id],
            );
            if (!used) throw new HttpError(403, 'That invite link has expired or was already used. Ask the site admin for a new one.', 'invite_invalid');
          }
          return user;
        });
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_key')) throw conflict('An account with that email already exists');
        throw err;
      }
      await reply.startSession(row.id);
      return reply.code(201).send({ user: out.user(row) });
    },
  );

  app.post(
    '/auth/login',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string', maxLength: 254 }, password: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const row = await db.one(
        'SELECT id, email, display_name, is_site_admin, password_hash FROM users WHERE email = $1',
        [request.body.email.trim().toLowerCase()],
      );
      const ok = await verifyPassword(request.body.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) throw new HttpError(401, 'Email or password is incorrect', 'invalid_credentials');
      await reply.startSession(row.id);
      return { user: out.user(row) };
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    await reply.endSession(request.sessionId);
    return { ok: true };
  });

  app.get('/auth/me', async (request) => ({ user: out.user(request.user) }));

  /** For the Account page: photo storage used, and what deleting the account would remove. */
  app.get('/auth/me/account', async (request) => {
    const me = request.requireUser();
    const [storageUse, owned] = await Promise.all([storageFor(db, settings, config, me.id), ownedCatalogues(db, me.id)]);
    return {
      storage: { usedBytes: storageUse.usedBytes, photos: storageUse.photos, quotaMb: storageUse.quotaMb },
      ownedCatalogues: owned.map((c) => ({ slug: c.slug, name: c.name, sightings: c.sightings, photos: c.photos, otherMembers: c.other_members })),
    };
  });

  /** Delete your own account (password required). Catalogues you own are deleted with it. */
  app.delete(
    '/auth/me',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: { type: 'object', required: ['password'], properties: { password: { type: 'string', maxLength: 200 } } } },
    },
    async (request, reply) => {
      const me = request.requireUser();
      const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [me.id]);
      if (!(await verifyPassword(request.body.password, row.password_hash))) {
        throw badRequest('That password is incorrect', 'invalid_credentials');
      }
      await deleteUser(db, storage, me.id, request.log);
      await reply.endSession(null);
      return { ok: true };
    },
  );

  app.patch(
    '/auth/me',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            displayName,
            currentPassword: { type: 'string', maxLength: 200 },
            newPassword: password,
          },
        },
      },
    },
    async (request) => {
      const me = request.requireUser();
      const { displayName: newName, currentPassword, newPassword } = request.body;

      if (newPassword) {
        const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [me.id]);
        if (!currentPassword || !(await verifyPassword(currentPassword, row.password_hash))) {
          throw badRequest('Current password is incorrect', 'invalid_credentials');
        }
        await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [me.id, await hashPassword(newPassword)]);
        // Sign out every other device.
        await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [me.id, request.sessionId]);
      }
      if (newName !== undefined) {
        if (!newName.trim()) throw badRequest('Display name is required');
        await db.query('UPDATE users SET display_name = $2 WHERE id = $1', [me.id, newName.trim()]);
      }
      const row = await db.one('SELECT id, email, display_name, is_site_admin FROM users WHERE id = $1', [me.id]);
      return { user: out.user(row) };
    },
  );
}
