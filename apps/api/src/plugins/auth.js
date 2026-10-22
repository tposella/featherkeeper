import { createHash, randomBytes } from 'node:crypto';
import { unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'fk_session';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Cookie sessions stored in Postgres. Adds:
 *   request.user            the signed-in user or null
 *   request.requireUser()   returns the user or throws 401
 *   reply.startSession(id)  / reply.endSession()
 */
export async function authPlugin(app, { db, config }) {
  const maxAgeSeconds = config.sessionDays * 24 * 60 * 60;
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
  };

  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('requireUser', function requireUser() {
    if (!this.user) throw unauthorized();
    return this.user;
  });

  app.addHook('onRequest', async (request) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token || token.length > 200) return;
    const sessionId = hashToken(token);
    const user = await db.one(
      `SELECT u.id, u.email, u.display_name, u.is_site_admin
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now()`,
      [sessionId],
    );
    if (user) {
      request.user = user;
      request.sessionId = sessionId;
    }
  });

  app.decorateReply('startSession', async function startSession(userId) {
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [hashToken(token), userId, maxAgeSeconds],
    );
    this.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: maxAgeSeconds });
  });

  app.decorateReply('endSession', async function endSession(sessionId) {
    if (sessionId) await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    this.clearCookie(SESSION_COOKIE, cookieOptions);
  });

  // Tidy up expired sessions once an hour.
  const timer = setInterval(() => {
    db.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => app.log.warn(err, 'session cleanup failed'));
  }, 60 * 60 * 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
// Let the decorators apply to the whole app instead of an encapsulated child.
authPlugin[Symbol.for('skip-override')] = true;
