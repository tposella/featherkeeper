import { readFileSync } from 'node:fs';

/**
 * Featherkeeper's version, and comparing versions.
 *
 * Versions are semantic (https://semver.org): MAJOR.MINOR.PATCH, optionally with a pre-release
 * part, e.g. 0.1.0-beta.1 < 0.1.0-beta.2 < 0.1.0 < 0.1.1 < 0.2.0.
 */
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** The running version: baked into release images, otherwise from package.json. */
export const VERSION =
  process.env.FEATHERKEEPER_VERSION && process.env.FEATHERKEEPER_VERSION !== 'dev' ? process.env.FEATHERKEEPER_VERSION : pkg.version;

/** "v0.1.0-beta.1" -> { core: [0, 1, 0], pre: ['beta', 1] }, or null if it isn't a version. */
export function parseVersion(text) {
  const m = String(text ?? '')
    .trim()
    .match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)],
    pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** Negative if a < b, 0 if equal, positive if a > b. Unparseable versions sort first. */
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // A release is newer than its pre-releases (0.1.0 > 0.1.0-beta.3).
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? 0 : 1) - (y.pre.length ? 0 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    if (typeof p === 'number') return -1; // numbers sort before words
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export const isPrerelease = (v) => Boolean(parseVersion(v)?.pre.length);
