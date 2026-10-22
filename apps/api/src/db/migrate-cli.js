// Run migrations without starting the server: `npm run migrate`
import { loadConfig } from '../config.js';
import { createDb } from './index.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  await migrate(db);
  console.log('Migrations up to date.');
} finally {
  await db.close();
}
