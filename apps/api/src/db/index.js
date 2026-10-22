import pg from 'pg';

// Return bigint (int8) ids as JS numbers; ids never come near 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export function createDb(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });

  const db = {
    pool,
    async query(text, params) {
      return pool.query(text, params);
    },
    async one(text, params) {
      const { rows } = await pool.query(text, params);
      return rows[0] ?? null;
    },
    async many(text, params) {
      const { rows } = await pool.query(text, params);
      return rows;
    },
    // Run fn inside a transaction; fn receives a client with the same helpers.
    async tx(fn) {
      const client = await pool.connect();
      const scoped = {
        query: (t, p) => client.query(t, p),
        one: async (t, p) => (await client.query(t, p)).rows[0] ?? null,
        many: async (t, p) => (await client.query(t, p)).rows,
      };
      try {
        await client.query('BEGIN');
        const result = await fn(scoped);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return db;
}
