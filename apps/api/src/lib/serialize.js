// Map database rows (snake_case) to API responses (camelCase).

export const iso = (d) => (d ? new Date(d).toISOString() : null);

export function user(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, displayName: u.display_name, isSiteAdmin: u.is_site_admin };
}

export function catalogue(c, extra = {}) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    regionCode: c.region_code,
    visibility: c.visibility,
    hideLocations: c.hide_locations,
    dexStyle: c.dex_style ?? 'slots',
    area:
      c.area_latitude === null || c.area_latitude === undefined
        ? null
        : { label: c.area_label, latitude: c.area_latitude, longitude: c.area_longitude, radiusKm: c.area_radius_km },
    createdAt: iso(c.created_at),
    updatedAt: iso(c.updated_at),
    ...extra,
  };
}

export function species(s) {
  return {
    id: s.id,
    ebirdCode: s.ebird_code,
    commonName: s.common_name,
    scientificName: s.scientific_name,
    familyCommon: s.family_common,
    familyScientific: s.family_scientific,
    taxonOrder: s.taxon_order,
    taxonSort: s.taxon_sort,
  };
}

export function photo(p, { showLocation, canDownloadOriginal, showReplace = true }) {
  return {
    id: p.id,
    sightingId: p.sighting_id,
    width: p.width,
    height: p.height,
    takenAt: iso(p.taken_at),
    camera: p.camera,
    lens: p.lens,
    latitude: showLocation ? p.latitude : null,
    longitude: showLocation ? p.longitude : null,
    exif: p.exif,
    originalName: p.original_name,
    sizeBytes: Number(p.size_bytes),
    createdAt: iso(p.created_at),
    // Marked as "want to replace" with a better shot.
    replace: showReplace && p.replace_wanted ? { note: p.replace_note ?? '', markedAt: iso(p.replace_marked_at) } : null,
    urls: {
      thumb: `/api/photos/${p.id}/thumb`,
      display: `/api/photos/${p.id}/display`,
      original: canDownloadOriginal ? `/api/photos/${p.id}/original` : null,
    },
  };
}

export function sighting(s, { showLocation }) {
  return {
    id: s.id,
    catalogueId: s.catalogue_id,
    speciesId: s.species_id,
    observedAt: iso(s.observed_at),
    latitude: showLocation ? s.latitude : null,
    longitude: showLocation ? s.longitude : null,
    locationName: s.location_name,
    notes: s.notes,
    createdBy: s.created_by_name ?? null,
    createdAt: iso(s.created_at),
    updatedAt: iso(s.updated_at),
  };
}
