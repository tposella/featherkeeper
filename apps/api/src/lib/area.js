/**
 * Where a catalogue's birds are, for "in season" and "when and where" information:
 *   1. the catalogue's area (town + radius, set by an area import)
 *   2. the middle of the catalogue's own sightings, with a 25 km radius
 *   3. its eBird region (eBird data only; iNaturalist needs a point)
 */
export async function catalogueArea(db, catalogueId) {
  const c = await db.one(
    'SELECT area_label, area_latitude, area_longitude, area_radius_km, region_code FROM catalogues WHERE id = $1',
    [catalogueId],
  );
  if (c.area_latitude !== null) {
    return {
      kind: 'area',
      latitude: c.area_latitude,
      longitude: c.area_longitude,
      radiusKm: c.area_radius_km ?? 25,
      label: c.area_label || null,
    };
  }
  const s = await db.one(
    `SELECT avg(latitude) AS lat, avg(longitude) AS lng, count(*)::int AS n
       FROM sightings WHERE catalogue_id = $1 AND latitude IS NOT NULL`,
    [catalogueId],
  );
  if (s.n > 0) return { kind: 'sightings', latitude: s.lat, longitude: s.lng, radiusKm: 25, label: null };
  if (c.region_code) return { kind: 'region', regionCode: c.region_code, label: c.region_code };
  return null;
}
