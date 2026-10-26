#!/usr/bin/env node
// Bump Featherkeeper's version everywhere it's recorded, and turn the CHANGELOG's "Unreleased"
// section into the new version's section. Push the result to main and the release workflow tags
// it, publishes the Docker images and writes the GitHub release.
//
// Versions are x.y.z:
//   node scripts/bump-version.mjs patch     0.1.0 -> 0.1.1   a smaller change (fixes, small additions)
//   node scripts/bump-version.mjs minor     0.1.1 -> 0.2.0   a bigger change (new features)
//   node scripts/bump-version.mjs major     0.9.0 -> 1.0.0
//   node scripts/bump-version.mjs 0.3.0     an exact version
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => path.join(root, p);
const PACKAGES = ['apps/api', 'apps/web'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/; // older versions had -beta.N

function next(current, how) {
  const m = current.match(SEMVER);
  if (!m) throw new Error(`The current version "${current}" isn't semver`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4];
  switch (how) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      // From an old pre-release (0.1.0-beta.1), "patch" gives the release itself (0.1.0).
      return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
    default:
      if (!/^\d+\.\d+\.\d+$/.test(how)) throw new Error(`"${how}" isn't patch, minor, major or a version like 1.2.3`);
      return how;
  }
}

const how = process.argv[2];
if (!how) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(2);
}

const current = JSON.parse(readFileSync(at('apps/api/package.json'), 'utf8')).version;
const version = next(current, how);
const today = new Date().toISOString().slice(0, 10);

for (const dir of PACKAGES) {
  for (const file of ['package.json', 'package-lock.json']) {
    const p = at(`${dir}/${file}`);
    const json = JSON.parse(readFileSync(p, 'utf8'));
    json.version = version;
    if (json.packages?.['']) json.packages[''].version = version;
    writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  }
}

// CHANGELOG: "## [Unreleased]" becomes "## [x.y.z] - date", with a fresh empty Unreleased above it.
const changelogPath = at('CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf8');
const unreleased = changelog.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|\n\[Unreleased\]:|$)/);
const body = unreleased ? unreleased[1].trim() : '';
changelog = changelog.replace(/## \[Unreleased\]\n[\s\S]*?(?=\n## \[|\n\[Unreleased\]:|$)/, `## [Unreleased]\n\n## [${version}] - ${today}\n\n${body || '- (describe the changes here)'}\n`);
const repo = 'https://github.com/tposella/featherkeeper';
changelog = changelog.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${repo}/compare/v${version}...HEAD\n[${version}]: ${repo}/compare/v${current}...v${version}`);
writeFileSync(changelogPath, changelog);

console.log(`Featherkeeper ${current} -> ${version}`);
if (!body) console.log('CHANGELOG.md had nothing under "Unreleased": fill in the new section before pushing.');
console.log(`Next: review CHANGELOG.md, commit, and push to main. The release workflow publishes v${version}.`);
