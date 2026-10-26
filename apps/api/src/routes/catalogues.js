import { loadCatalogue, requireEdit, requireManage } from '../lib/access.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import * as out from '../lib/serialize.js';
import { slugify, SLUG_PATTERN } from '../lib/slug.js';
import { deleteCatalogue } from '../lib/accounts.js';

const visibility = { type: 'string', enum: ['private', 'members', 'public'] };
const catalogueFields = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  slug: { type: 'string', pattern: SLUG_PATTERN, maxLength: 64 },
  description: { type: 'string', maxLength: 4000 },
  regionCode: { type: ['string', 'null'], maxLength: 20 },
  visibility,
  hideLocations: { type: 'boolean' },
  dexStyle: { type: 'string', enum: ['slots', 'examples'] },
};
const slugParam = { type: 'object', required: ['slug'], properties: { slug: { type: 'string', maxLength: 64 } } };

// Per-catalogue counts used on cards and headers.
const STATS_SQL = `
  (SELECT count(*) FROM catalogue_species cs WHERE cs.catalogue_id = c.id)::int AS species_count,
  (SELECT count(DISTINCT s.species_id) FROM sightings s JOIN photos p ON p.sighting_id = s.id
     WHERE s.catalogue_id = c.id)::int AS photographed_count,
  (SELECT count(*) FROM photos p JOIN sightings s ON s.id = p.sighting_id WHERE s.catalogue_id = c.id)::int AS photo_count,
  (SELECT count(*) FROM photos p JOIN sightings s ON s.id = p.sighting_id
     WHERE s.catalogue_id = c.id AND p.replace_wanted)::int AS replace_count,
  (SELECT p.id FROM photos p JOIN sightings s ON s.id = p.sighting_id
     WHERE s.catalogue_id = c.id ORDER BY p.created_at DESC LIMIT 1) AS latest_photo_id,
  (SELECT u.display_name FROM catalogue_members m JOIN users u ON u.id = m.user_id
     WHERE m.catalogue_id = c.id AND m.role = 'owner') AS owner_name`;

function withStats(row, access) {
  const base = out.catalogue(row);
  // The catalogue's area is a location too: viewers don't get its coordinates when locations are hidden.
  if (base.area && row.hide_locations && !access.canEdit) base.area = { ...base.area, latitude: null, longitude: null };
  return Object.assign(base, {
    ownerName: row.owner_name,
    stats: {
      species: row.species_count,
      photographed: row.photographed_count,
      photos: row.photo_count,
      toReplace: row.replace_count,
    },
    coverUrl: row.latest_photo_id ? `/api/photos/${row.latest_photo_id}/thumb` : null,
    access,
  });
}

async function uniqueSlug(db, base) {
  const root = base || 'catalogue';
  for (let i = 1; i < 1000; i += 1) {
    const candidate = i === 1 ? root : `${root.slice(0, 58)}-${i}`;
    const taken = await db.one('SELECT 1 FROM catalogues WHERE slug = $1', [candidate]);
    if (!taken) return candidate;
  }
  throw conflict('Could not find a free URL name; choose one yourself');
}

export default async function catalogueRoutes(app, { db, storage }) {
  // Every catalogue the caller is allowed to see.
  app.get('/catalogues', async (request) => {
    const user = request.user;
    const rows = await db.many(
      `SELECT c.*, m.role, ${STATS_SQL}
         FROM catalogues c
         LEFT JOIN catalogue_members m ON m.catalogue_id = c.id AND m.user_id = $1
        WHERE c.visibility = 'public'
           OR ($1::bigint IS NOT NULL AND c.visibility = 'members')
           OR m.role IS NOT NULL
           OR $2
        ORDER BY (m.role IS NOT NULL) DESC, c.updated_at DESC`,
      [user?.id ?? null, Boolean(user?.is_site_admin)],
    );
    return {
      catalogues: rows.map((r) =>
        withStats(r, {
          role: r.role ?? null,
          canEdit: ['owner', 'editor'].includes(r.role) || Boolean(user?.is_site_admin),
          canManage: r.role === 'owner' || Boolean(user?.is_site_admin),
        }),
      ),
    };
  });

  app.post(
    '/catalogues',
    {
      schema: {
        body: { type: 'object', required: ['name'], properties: catalogueFields },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const body = request.body;
      const name = body.name.trim();
      if (!name) throw badRequest('Name is required');
      const slug = body.slug ?? (await uniqueSlug(db, slugify(name)));

      let row;
      try {
        row = await db.tx(async (t) => {
          const c = await t.one(
            `INSERT INTO catalogues (slug, name, description, region_code, visibility, hide_locations)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              slug,
              name,
              body.description ?? '',
              body.regionCode?.trim().toUpperCase() || null,
              body.visibility ?? 'private',
              body.hideLocations ?? false,
            ],
          );
          await t.query(`INSERT INTO catalogue_members (catalogue_id, user_id, role) VALUES ($1, $2, 'owner')`, [
            c.id,
            user.id,
          ]);
          return c;
        });
      } catch (err) {
        if (isUniqueViolation(err, 'catalogues_slug_key')) throw conflict('That URL name is already taken', 'slug_taken');
        throw err;
      }
      const { catalogue, access } = await loadCatalogue(db, row.id, user);
      const full = await db.one(`SELECT c.*, ${STATS_SQL} FROM catalogues c WHERE c.id = $1`, [catalogue.id]);
      return reply.code(201).send({ catalogue: withStats(full, access) });
    },
  );

  app.get('/catalogues/:slug', { schema: { params: slugParam } }, async (request) => {
    const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
    const full = await db.one(`SELECT c.*, ${STATS_SQL} FROM catalogues c WHERE c.id = $1`, [catalogue.id]);
    return { catalogue: withStats(full, access) };
  });

  app.patch(
    '/catalogues/:slug',
    {
      schema: {
        params: slugParam,
        body: { type: 'object', minProperties: 1, properties: catalogueFields },
      },
    },
    async (request) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      requireManage(access, request.user);
      const b = request.body;
      if (b.name !== undefined && !b.name.trim()) throw badRequest('Name is required');
      try {
        await db.query(
          `UPDATE catalogues SET
             name = coalesce($2, name),
             slug = coalesce($3, slug),
             description = coalesce($4, description),
             region_code = CASE WHEN $5 THEN $6 ELSE region_code END,
             visibility = coalesce($7, visibility),
             hide_locations = coalesce($8, hide_locations),
             dex_style = coalesce($9, dex_style),
             updated_at = now()
           WHERE id = $1`,
          [
            catalogue.id,
            b.name?.trim() ?? null,
            b.slug ?? null,
            b.description ?? null,
            'regionCode' in b,
            b.regionCode?.trim().toUpperCase() || null,
            b.visibility ?? null,
            b.hideLocations ?? null,
            b.dexStyle ?? null,
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err, 'catalogues_slug_key')) throw conflict('That URL name is already taken', 'slug_taken');
        throw err;
      }
      const full = await db.one(`SELECT c.*, ${STATS_SQL} FROM catalogues c WHERE c.id = $1`, [catalogue.id]);
      return { catalogue: withStats(full, access) };
    },
  );

  app.delete('/catalogues/:slug', { schema: { params: slugParam } }, async (request) => {
    const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
    requireManage(access, request.user);
    await deleteCatalogue(db, storage, catalogue.id, request.log);
    return { ok: true };
  });

  // ---- Members ------------------------------------------------------------

  app.get('/catalogues/:slug/members', { schema: { params: slugParam } }, async (request) => {
    const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
    requireEdit(access, request.user);
    const rows = await db.many(
      `SELECT u.id, u.display_name, u.email, m.role, m.added_at
         FROM catalogue_members m JOIN users u ON u.id = m.user_id
        WHERE m.catalogue_id = $1
        ORDER BY (m.role = 'owner') DESC, u.display_name`,
      [catalogue.id],
    );
    return {
      members: rows.map((r) => ({
        userId: r.id,
        displayName: r.display_name,
        // Only the owner sees editors' email addresses.
        email: access.canManage ? r.email : null,
        role: r.role,
        addedAt: out.iso(r.added_at),
      })),
    };
  });

  app.post(
    '/catalogues/:slug/members',
    {
      schema: {
        params: slugParam,
        body: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', maxLength: 254 }, role: { type: 'string', enum: ['editor'] } },
        },
      },
    },
    async (request, reply) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      requireManage(access, request.user);
      const target = await db.one('SELECT id, display_name FROM users WHERE email = $1', [
        request.body.email.trim().toLowerCase(),
      ]);
      if (!target) throw notFound('No account uses that email. Ask them to register first.');
      try {
        await db.query(
          `INSERT INTO catalogue_members (catalogue_id, user_id, role) VALUES ($1, $2, 'editor')`,
          [catalogue.id, target.id],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`${target.display_name} is already a member`);
        throw err;
      }
      return reply.code(201).send({ ok: true });
    },
  );

  // Transfer ownership: the target becomes owner and the old owner becomes an editor.
  app.patch(
    '/catalogues/:slug/members/:userId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['slug', 'userId'],
          properties: { slug: { type: 'string' }, userId: { type: 'integer' } },
        },
        body: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['owner'] } } },
      },
    },
    async (request) => {
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, request.user);
      requireManage(access, request.user);
      const target = await db.one('SELECT role FROM catalogue_members WHERE catalogue_id = $1 AND user_id = $2', [
        catalogue.id,
        request.params.userId,
      ]);
      if (!target) throw notFound('That person is not a member of this catalogue');
      if (target.role === 'owner') return { ok: true };
      await db.tx(async (t) => {
        await t.query(`UPDATE catalogue_members SET role = 'editor' WHERE catalogue_id = $1 AND role = 'owner'`, [
          catalogue.id,
        ]);
        await t.query(`UPDATE catalogue_members SET role = 'owner' WHERE catalogue_id = $1 AND user_id = $2`, [
          catalogue.id,
          request.params.userId,
        ]);
      });
      return { ok: true };
    },
  );

  // The owner can remove editors; editors can remove themselves.
  app.delete(
    '/catalogues/:slug/members/:userId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['slug', 'userId'],
          properties: { slug: { type: 'string' }, userId: { type: 'integer' } },
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { catalogue, access } = await loadCatalogue(db, request.params.slug, user);
      const self = request.params.userId === user.id;
      if (!self && !access.canManage) throw forbidden('Only the catalogue owner can remove editors');
      const target = await db.one('SELECT role FROM catalogue_members WHERE catalogue_id = $1 AND user_id = $2', [
        catalogue.id,
        request.params.userId,
      ]);
      if (!target) throw notFound('That person is not a member of this catalogue');
      if (target.role === 'owner') throw conflict('Transfer ownership before removing the owner');
      await db.query('DELETE FROM catalogue_members WHERE catalogue_id = $1 AND user_id = $2', [
        catalogue.id,
        request.params.userId,
      ]);
      return { ok: true };
    },
  );
}
