import { compareVersions, isPrerelease, parseVersion } from '../lib/version.js';

/**
 * Checks GitHub for a newer Featherkeeper release, so the site admin can be told about updates.
 * Uses the public releases list of the project's repository (no account or key needed), and asks
 * at most every few hours. Only the request itself is sent: nothing about this site or its users.
 *
 * Which releases count: a site on a pre-release or a 0.x version is told about every newer release;
 * a site on a stable 1.0+ version only about stable ones.
 */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 30 * 60 * 1000;

export function createUpdateChecker({ enabled = true, repo, currentVersion, userAgent }, fetchImpl = globalThis.fetch) {
  let cache = null; // { checkedAt, latest, error }
  let inflight = null;

  async function fetchLatest() {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
    const releases = await res.json();
    const wantsPre = isPrerelease(currentVersion) || (parseVersion(currentVersion)?.core[0] ?? 0) === 0;
    const candidates = (Array.isArray(releases) ? releases : [])
      .filter((r) => !r.draft && parseVersion(r.tag_name))
      .filter((r) => wantsPre || (!r.prerelease && !isPrerelease(r.tag_name)))
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
    const top = candidates[0];
    if (!top) return null;
    return {
      version: top.tag_name.replace(/^v/, ''),
      name: top.name || top.tag_name,
      url: top.html_url,
      publishedAt: top.published_at,
      prerelease: Boolean(top.prerelease),
      // The first part of the release notes, as plain text, for a short "what's new".
      notes: String(top.body ?? '')
        .split(/\n### (?:Install or update|Docker images)/)[0]
        .trim()
        .slice(0, 4000),
    };
  }

  async function check(force = false) {
    const age = cache ? Date.now() - cache.checkedAt : Infinity;
    const fresh = cache && age < (cache.error ? RETRY_AFTER_ERROR_MS : CHECK_EVERY_MS);
    if (fresh && !force) return cache;
    if (!inflight) {
      inflight = fetchLatest()
        .then((latest) => (cache = { checkedAt: Date.now(), latest, error: null }))
        .catch((err) => (cache = { checkedAt: Date.now(), latest: cache?.latest ?? null, error: err.message }))
        .finally(() => (inflight = null));
    }
    return inflight;
  }

  return {
    enabled,
    repo,
    currentVersion,
    /** { current, latest, updateAvailable, checkedAt, error } */
    async status({ force = false } = {}) {
      if (!enabled) return { current: currentVersion, latest: null, updateAvailable: false, checkedAt: null, error: null, enabled: false };
      const c = await check(force);
      const updateAvailable = Boolean(c.latest && compareVersions(c.latest.version, currentVersion) > 0);
      return {
        current: currentVersion,
        latest: c.latest,
        updateAvailable,
        checkedAt: new Date(c.checkedAt).toISOString(),
        error: c.error,
        enabled: true,
      };
    },
  };
}
