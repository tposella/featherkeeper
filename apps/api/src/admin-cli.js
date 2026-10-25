// Featherkeeper admin commands, run on the server:
//
//   docker compose exec api node src/admin-cli.js list-users
//   docker compose exec api node src/admin-cli.js reset-password you@example.com
//   docker compose exec api node src/admin-cli.js reset-password you@example.com --password "a new password"
//   docker compose exec api node src/admin-cli.js make-admin you@example.com
//
// reset-password prints a temporary password (unless you give one) and signs that user out everywhere.
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { hashPassword, MIN_PASSWORD_LENGTH, temporaryPassword } from './lib/passwords.js';

const [command, email, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  if (i >= 0) return rest[i + 1];
  const eq = rest.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};

const USAGE = `Usage:
  node src/admin-cli.js list-users
  node src/admin-cli.js reset-password <email> [--password <new password>]
  node src/admin-cli.js make-admin <email>`;

async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  try {
    if (command === 'list-users') {
      const rows = await db.many('SELECT email, display_name, is_site_admin, created_at FROM users ORDER BY created_at');
      if (!rows.length) console.log('No users yet. The first account created becomes the site admin.');
      for (const r of rows) console.log(`${r.is_site_admin ? 'admin ' : '      '} ${r.email}  (${r.display_name})`);
      return 0;
    }

    if (!email) {
      console.error(USAGE);
      return 2;
    }
    const user = await db.one('SELECT id, email FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (!user) {
      console.error(`No user with the email ${email}. Run "list-users" to see them.`);
      return 1;
    }

    if (command === 'reset-password') {
      const typed = flag('password');
      if (typed !== undefined && typed.length < MIN_PASSWORD_LENGTH) {
        console.error(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return 2;
      }
      const password = typed ?? temporaryPassword();
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(password)]);
      await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      console.log(`Password reset for ${user.email}. They've been signed out everywhere.`);
      if (!typed) {
        console.log(`Temporary password: ${password}`);
        console.log('Sign in with it, then change it under Account.');
      }
      return 0;
    }

    if (command === 'make-admin') {
      await db.query('UPDATE users SET is_site_admin = true WHERE id = $1', [user.id]);
      console.log(`${user.email} is now a site admin.`);
      return 0;
    }

    console.error(`Unknown command "${command}".\n${USAGE}`);
    return 2;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
