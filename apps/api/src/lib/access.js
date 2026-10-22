import { forbidden, notFound, unauthorized } from './errors.js';

/**
 * The single source of truth for catalogue permissions.
 *
 *   view   = public, or signed in and "members", or a member of the catalogue, or site admin
 *   edit   = owner or editor (or site admin)
 *   manage = owner (or site admin): settings, visibility, members, delete
 */
export function accessFor(catalogue, role, user) {
  const isAdmin = Boolean(user?.is_site_admin);
  const canView =
    catalogue.visibility === 'public' ||
    (Boolean(user) && catalogue.visibility === 'members') ||
    Boolean(role) ||
    isAdmin;
  const canEdit = role === 'owner' || role === 'editor' || isAdmin;
  const canManage = role === 'owner' || isAdmin;
  return { role: role ?? null, canView, canEdit, canManage };
}

const CATALOGUE_COLUMNS = `c.id, c.slug, c.name, c.description, c.region_code, c.visibility,
  c.hide_locations, c.created_at, c.updated_at`;

/**
 * Load a catalogue by slug or id together with the caller's access.
 * Throws 404 when the catalogue doesn't exist *or* the caller can't view it,
 * so private catalogues don't leak their existence.
 */
export async function loadCatalogue(db, ref, user) {
  const byId = typeof ref === 'number';
  const row = await db.one(
    `SELECT ${CATALOGUE_COLUMNS}, m.role
       FROM catalogues c
       LEFT JOIN catalogue_members m ON m.catalogue_id = c.id AND m.user_id = $2
      WHERE ${byId ? 'c.id = $1' : 'c.slug = $1'}`,
    [ref, user?.id ?? null],
  );
  if (!row) throw notFound('Catalogue not found');
  const { role, ...catalogue } = row;
  const access = accessFor(catalogue, role, user);
  if (!access.canView) throw notFound('Catalogue not found');
  return { catalogue, access };
}

export function requireEdit(access, user) {
  if (!user) throw unauthorized();
  if (!access.canEdit) throw forbidden('Only the owner and editors can change this catalogue');
}

export function requireManage(access, user) {
  if (!user) throw unauthorized();
  if (!access.canManage) throw forbidden('Only the catalogue owner can do that');
}

/** Hide coordinates from people who can't edit when the catalogue asks for it. */
export function locationsVisible(catalogue, access) {
  return !catalogue.hide_locations || access.canEdit;
}
