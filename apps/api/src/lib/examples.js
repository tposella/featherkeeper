import sharp from 'sharp';

/**
 * Example photos for the dex's "greyed examples" view (the default). Species are queued as soon as
 * they're added to a catalogue, at startup for anything still missing, and whenever a dex is viewed in
 * that style; a slow background worker looks each one up with the reference client, downloads one
 * openly licensed photo, shrinks it to a 480 px WebP and stores it in species_examples with its credit.
 * One species at a time with a pause between, to stay well inside iNaturalist's rate limits.
 * When nothing is found, the dex query (DEX_SQL) asks for another try a day later.
 */
const MAX_DOWNLOAD = 15 * 1024 * 1024;

export function createExamples({ db, reference, userAgent, log, fetchImpl = globalThis.fetch, pauseMs = 1000 }) {
  const queue = [];
  const queued = new Set();
  let running = false;
  let idleWaiters = [];

  async function download(url) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD) throw new Error('too large');
    return sharp(buf).rotate().resize(480, 480, { fit: 'cover' }).webp({ quality: 72 }).toBuffer();
  }

  async function fill(speciesId) {
    const sp = await db.one('SELECT id, scientific_name, common_name FROM species WHERE id = $1', [speciesId]);
    if (!sp) return;
    let image = null;
    let meta = null;
    try {
      const ref = await reference.forSpecies(sp.scientific_name, sp.common_name);
      for (const p of ref.photos ?? []) {
        try {
          image = await download(p.medium || p.url);
          meta = { credit: p.credit || '', licence: p.licence || '', source: p.source || '', page: p.page || null };
          break;
        } catch (err) {
          log?.debug?.({ err: err.message, speciesId }, 'example photo download failed');
        }
      }
    } catch (err) {
      log?.warn?.({ err: err.message, speciesId }, 'example photo lookup failed');
    }
    await db.query(
      `INSERT INTO species_examples (species_id, image, meta, checked_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (species_id) DO UPDATE SET
         image = coalesce(EXCLUDED.image, species_examples.image),
         meta = coalesce(EXCLUDED.meta, species_examples.meta),
         checked_at = now()`,
      [sp.id, image, meta],
    );
  }

  async function work() {
    if (running) return;
    running = true;
    while (queue.length) {
      const id = queue.shift();
      try {
        await fill(id);
      } catch (err) {
        log?.warn?.({ err: err.message, speciesId: id }, 'could not store example photo');
      }
      queued.delete(id);
      if (queue.length && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    }
    running = false;
    idleWaiters.forEach((r) => r());
    idleWaiters = [];
  }

  return {
    enabled: reference.enabled !== false,
    /** Queue species ids for lookup; returns how many are waiting in total. */
    queue(ids) {
      if (this.enabled) {
        for (const id of ids) {
          const n = Number(id);
          if (!queued.has(n)) {
            queued.add(n);
            queue.push(n);
          }
        }
        if (queue.length) work();
      }
      return queued.size;
    },
    /**
     * Queue every species that still needs an example photo, in one catalogue or (with no id) in all
     * of them. Returns how many are waiting.
     */
    async prepare(catalogueId = null) {
      if (!this.enabled) return 0;
      const rows = await db.many(
        `SELECT DISTINCT cs.species_id AS id
           FROM catalogue_species cs
           LEFT JOIN species_examples ex ON ex.species_id = cs.species_id
          WHERE ($1::bigint IS NULL OR cs.catalogue_id = $1)
            AND (ex.species_id IS NULL OR (ex.image IS NULL AND ex.checked_at < now() - interval '1 day'))`,
        [catalogueId],
      );
      return this.queue(rows.map((r) => r.id));
    },
    pending: () => queued.size,
    isQueued: (id) => queued.has(Number(id)),
    /** Resolves when the queue is empty (used by tests). */
    idle: () => (running || queue.length ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
  };
}
