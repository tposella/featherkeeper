/**
 * Which species a photo could plausibly be, and how plausible each is a priori.
 *
 * With a location (photo GPS, the user's map pin, or the catalogue's area):
 *   seen within RADIUS_KM in the last 30 days      prior 1.0
 *   recorded within RADIUS_KM at any time          prior 0.4
 *   in the catalogue but not recorded near there   prior 0.08
 * Without a location: every species in the catalogue, prior 1.0.
 *
 * The image model's probabilities are multiplied by these priors, so a bird eBird
 * has never recorded nearby needs much stronger visual evidence to come out on top.
 */
export const RADIUS_KM = 25;
export const PRIORS = { recent: 1.0, area: 0.4, elsewhere: 0.08 };

export async function buildCandidates({ db, ebird, catalogueId, location, log }) {
  const dex = await db.many(
    `SELECT sp.id, sp.ebird_code, sp.common_name, sp.scientific_name, sp.family_scientific, sp.taxon_order
       FROM catalogue_species cs JOIN species sp ON sp.id = cs.species_id
      WHERE cs.catalogue_id = $1`,
    [catalogueId],
  );

  let area = new Set();
  let recent = new Set();
  let extra = [];
  let usedLocation = false;
  if (location && ebird.enabled) {
    try {
      const [{ codes }, recentCodes] = await Promise.all([
        ebird.speciesCodesFor({ latitude: location.latitude, longitude: location.longitude, radiusKm: RADIUS_KM }),
        ebird.recentSpeciesNear(location.latitude, location.longitude, RADIUS_KM, 30),
      ]);
      area = new Set(codes);
      recent = new Set(recentCodes);
      usedLocation = true;
      const known = new Set(dex.map((d) => d.ebird_code).filter(Boolean));
      const missing = [...new Set([...area, ...recent])].filter((c) => !known.has(c));
      extra = missing.length ? await ebird.taxonomy(missing) : [];
    } catch (err) {
      // No hotspots near a remote spot, or eBird unreachable: fall back to the catalogue alone.
      log?.warn({ err: err.message }, 'location prior unavailable; using catalogue species only');
    }
  }

  const priorFor = (code) => {
    if (!usedLocation) return 1;
    if (code && recent.has(code)) return PRIORS.recent;
    if (code && area.has(code)) return PRIORS.area;
    return PRIORS.elsewhere;
  };

  const candidates = [
    ...dex.map((d) => ({
      id: d.ebird_code ? `ebird:${d.ebird_code}` : `species:${d.id}`,
      ebirdCode: d.ebird_code,
      speciesId: d.id,
      scientificName: d.scientific_name,
      commonName: d.common_name,
      order: d.taxon_order,
      family: d.family_scientific,
      prior: priorFor(d.ebird_code),
    })),
    ...extra.map((t) => ({
      id: `ebird:${t.ebirdCode}`,
      ebirdCode: t.ebirdCode,
      speciesId: null,
      scientificName: t.scientificName,
      commonName: t.commonName,
      order: t.taxonOrder,
      family: t.familyScientific,
      prior: priorFor(t.ebirdCode),
    })),
  ];

  return {
    candidates,
    summary: {
      usedLocation,
      candidates: candidates.length,
      recentNearby: recent.size,
      recordedNearby: area.size,
      radiusKm: RADIUS_KM,
    },
    tagFor(code) {
      if (!usedLocation || !code) return null;
      if (recent.has(code)) return 'recent';
      if (area.has(code)) return 'area';
      return 'elsewhere';
    },
  };
}
