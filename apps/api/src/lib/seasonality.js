/**
 * Which months of the year a species is around near the catalogue, and how tied it is to the month
 * being viewed.
 *
 * From iNaturalist photo counts near the area, for each of the 12 months: what share of all bird
 * photos that month are of this species. Using a share rather than the raw count cancels out that
 * people simply photograph more in summer. Each month's share is then compared with the species' best
 * month: a month counts as "around" when the species is photographed there at least a fifth as often
 * as at its peak, and at least twice in five years. So a robin that is common from March to October
 * and only a handful of stragglers stay the winter is "around Mar–Oct".
 *
 * Then, for the month being viewed:
 *   off-peak     it has been photographed this month, but rarely compared with its other months
 *   now-only     around 3 months of the year or fewer, including this one (passing migrants)
 *   seasonal     around 4 to 8 months, including this one (summer or winter birds)
 *   year-round   around 9 months or more
 */
const MIN_PHOTOS = 8; // fewer photos than this all year: too few to say
const AROUND_SHARE = 0.2; // a month counts if the species is at least this fraction as frequent as at its peak
const AROUND_MIN_PHOTOS = 2; // ...and was photographed at least this many times that month

export const NOW_ONLY_MONTHS = 3;
export const YEAR_ROUND_MONTHS = 9;

/**
 * The profile of one species.
 * @param {number[]} counts  this species' photos in each month, January first
 * @param {number[]} totals  all birds' photos in each month, January first
 * @param {number} month     the month being viewed, 1-12
 */
export function monthlyProfile(counts, totals, month) {
  const yearPhotos = counts.reduce((a, b) => a + b, 0);
  if (yearPhotos < MIN_PHOTOS) return null;
  const rate = counts.map((c, i) => (totals[i] > 0 ? c / totals[i] : 0));
  const peak = Math.max(...rate);
  if (!(peak > 0)) return null;
  const profile = rate.map((r) => r / peak);
  const around = profile.map((p, i) => p >= AROUND_SHARE && counts[i] >= AROUND_MIN_PHOTOS);
  const monthsAround = around.filter(Boolean).length;
  const here = around[month - 1];
  const kind = !here
    ? 'off-peak'
    : monthsAround >= YEAR_ROUND_MONTHS
      ? 'year-round'
      : monthsAround <= NOW_ONLY_MONTHS
        ? 'now-only'
        : 'seasonal';
  // How much more often than in an average month it is photographed in this month (for sorting).
  const mean = rate.reduce((a, b) => a + b, 0) / 12;
  const lift = mean > 0 ? rate[month - 1] / mean : 0;
  return {
    kind,
    months: around,
    monthsAround,
    profile: profile.map((p) => Math.round(p * 100) / 100),
    lift: Math.round(lift * 10) / 10,
    share: Math.round((counts[month - 1] / yearPhotos) * 1000) / 1000,
    yearPhotos,
  };
}

/**
 * Profiles for every species, from the area's 12 monthly lists ([{ scientificName, observations }],
 * January first). Returns Map(lowercase scientific name -> profile) for `month` (1-12).
 */
export function seasonalityFor(byMonth, month) {
  const totals = byMonth.map((list) => list.reduce((n, s) => n + (s.observations ?? 0), 0));
  const counts = new Map();
  byMonth.forEach((list, i) => {
    for (const s of list) {
      const key = s.scientificName.toLowerCase();
      if (!counts.has(key)) counts.set(key, new Array(12).fill(0));
      counts.get(key)[i] += s.observations ?? 0;
    }
  });
  const out = new Map();
  for (const [key, c] of counts) {
    const p = monthlyProfile(c, totals, month);
    if (p) out.set(key, p);
  }
  return out;
}
