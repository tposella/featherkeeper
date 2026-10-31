/**
 * How tied a species is to one time of year near the catalogue.
 *
 * From iNaturalist photo counts near the area: how many of a species' photos (all months) were taken
 * in this month, compared with how many of all birds' photos were. Comparing with all birds cancels
 * out that people simply photograph more in summer. The result, "lift", reads as "how many times more
 * likely than usual this bird is in this month":
 *
 *   about 1      it's around all year (a chickadee, a magpie)
 *   1.5 or more  it's mostly here in a season (a summer warbler, a winter waxwing)
 *   3.5 or more  this month is most of its local year (a passing migrant)
 *
 * A species with only a handful of photos would swing wildly (2 photos, both in May, would score 12),
 * so its share is pulled towards the all-birds average by a few "pretend" average photos first.
 */
const PRIOR = 4; // pretend photos at the average share
const MIN_PHOTOS = 8; // fewer photos than this all year: too few to say

// More people photograph birds in summer, which pulls summer birds' lift down a little and winter
// birds' up; these thresholds sit slightly low to allow for that.
export const SEASONAL_LIFT = 1.5; // roughly "around for 7 months of the year or fewer"
export const NOW_ONLY_LIFT = 3.5; // roughly "around for 3 months or fewer"

/**
 * @param {number} monthCount  this species' photos in the month
 * @param {number} yearCount   this species' photos in all months
 * @param {number} baseline    all birds: photos in the month / photos in all months
 */
export function seasonality(monthCount, yearCount, baseline) {
  if (!(baseline > 0) || !(yearCount >= MIN_PHOTOS)) return null;
  const share = Math.min(1, monthCount / yearCount);
  const smoothed = (monthCount + PRIOR * baseline) / (yearCount + PRIOR);
  const lift = smoothed / baseline;
  const kind = lift >= NOW_ONLY_LIFT ? 'now-only' : lift >= SEASONAL_LIFT ? 'seasonal' : 'year-round';
  return { kind, lift: Math.round(lift * 10) / 10, share: Math.round(share * 1000) / 1000, yearPhotos: yearCount };
}

/**
 * Seasonality for every species in one month's list, given the same area's all-year list.
 * Both lists are [{ scientificName, observations }]. Returns Map(lowercase name -> seasonality).
 */
export function seasonalityFor(monthList, yearList) {
  const sum = (list) => list.reduce((n, s) => n + (s.observations ?? 0), 0);
  const allMonth = sum(monthList);
  const allYear = sum(yearList);
  const out = new Map();
  if (!allMonth || !allYear) return out;
  const baseline = allMonth / allYear;
  const yearBySci = new Map(yearList.map((s) => [s.scientificName.toLowerCase(), s.observations ?? 0]));
  for (const s of monthList) {
    const key = s.scientificName.toLowerCase();
    const result = seasonality(s.observations ?? 0, Math.max(yearBySci.get(key) ?? 0, s.observations ?? 0), baseline);
    if (result) out.set(key, result);
  }
  return out;
}
