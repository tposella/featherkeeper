/**
 * Keep species names in step with eBird. eBird updates its taxonomy every year: common and
 * scientific names change, families are reorganised, species are split or lumped. This looks up
 * every species that has an eBird code and updates names, family, order and field-guide order.
 * Codes eBird no longer has (usually a split or lump) are listed for the admin to review, since
 * which new species a sighting belongs to is a judgement call.
 *
 * Runs on its own about once a month (when an eBird key is set), or from the admin page.
 */
const FIELDS = [
  ['commonName', 'common_name'],
  ['scientificName', 'scientific_name'],
  ['familyCommon', 'family_common'],
  ['familyScientific', 'family_scientific'],
  ['taxonOrder', 'taxon_order'],
  ['taxonSort', 'taxon_sort'],
];
const EVERY_MS = 30 * 24 * 60 * 60 * 1000;

export async function refreshTaxonomy({ db, ebird, settings, log }) {
  const species = await db.many(
    `SELECT sp.*, (SELECT count(*) FROM catalogue_species cs WHERE cs.species_id = sp.id)::int AS catalogues
       FROM species sp WHERE sp.ebird_code IS NOT NULL ORDER BY sp.id`,
  );
  const current = new Map((species.length ? await ebird.taxonomy(species.map((s) => s.ebird_code)) : []).map((t) => [t.ebirdCode, t]));

  const updated = [];
  const notFound = [];
  const conflicts = [];
  for (const s of species) {
    const t = current.get(s.ebird_code);
    if (!t) {
      // Only worth reporting if someone uses it.
      if (s.catalogues) notFound.push({ ebirdCode: s.ebird_code, commonName: s.common_name, scientificName: s.scientific_name, catalogues: s.catalogues });
      continue;
    }
    const changes = FIELDS.filter(([k, col]) => (t[k] ?? null) !== (s[col] ?? null) && !(k === 'taxonSort' && Number(t[k]) === Number(s[col])));
    if (!changes.length) continue;
    try {
      await db.query(
        `UPDATE species SET common_name = $2, scientific_name = $3, family_common = $4, family_scientific = $5,
                taxon_order = $6, taxon_sort = $7 WHERE id = $1`,
        [s.id, t.commonName, t.scientificName, t.familyCommon, t.familyScientific, t.taxonOrder, t.taxonSort],
      );
      const renamed = changes.some(([k]) => k === 'commonName' || k === 'scientificName');
      updated.push({
        ebirdCode: s.ebird_code,
        from: `${s.common_name} (${s.scientific_name})`,
        to: `${t.commonName} (${t.scientificName})`,
        renamed,
      });
    } catch (err) {
      // e.g. the new scientific name already belongs to another species row (a lump).
      if (err.code !== '23505') throw err;
      conflicts.push({ ebirdCode: s.ebird_code, commonName: s.common_name, newName: `${t.commonName} (${t.scientificName})` });
    }
  }
  const report = {
    refreshedAt: new Date().toISOString(),
    checked: species.length,
    updated,
    renamed: updated.filter((u) => u.renamed).length,
    notFound,
    conflicts,
  };
  await settings.set('taxonomy', report);
  if (updated.length || notFound.length) {
    log?.info?.(`eBird taxonomy: ${updated.length} species updated, ${notFound.length} no longer in eBird's list`);
  }
  return report;
}

/** Refresh in the background if it's been about a month (checked at startup and once a day). */
export function scheduleTaxonomyRefresh({ db, ebird, settings, log }) {
  if (!ebird.enabled) return () => {};
  const tick = async () => {
    try {
      const last = await settings.get('taxonomy');
      if (last?.refreshedAt && Date.now() - Date.parse(last.refreshedAt) < EVERY_MS) return;
      await refreshTaxonomy({ db, ebird, settings, log });
    } catch (err) {
      log?.warn?.({ err: err.message }, 'eBird taxonomy refresh failed; will try again tomorrow');
    }
  };
  const first = setTimeout(tick, 60 * 1000);
  const daily = setInterval(tick, 24 * 60 * 60 * 1000);
  first.unref?.();
  daily.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
