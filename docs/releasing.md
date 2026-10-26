# Versions and releases

Every update to Featherkeeper gets a version number, so a running site can tell when a newer one is
out and what changed.

## Version numbers

Versions are `x.y.z`:

| Change | Example | Command |
| --- | --- | --- |
| **A smaller change**: fixes, tweaks, small additions | 0.1.0 → 0.1.1 | `node scripts/bump-version.mjs patch` |
| **A bigger change**: new features, anything that changes how you use it | 0.1.1 → 0.2.0 | `node scripts/bump-version.mjs minor` |
| 1.0 and beyond | 0.9.0 → 1.0.0 | `node scripts/bump-version.mjs major` |

0.x versions are early releases: expect changes between them, and keep backups.

## Making a release

1. Note what changed under `## [Unreleased]` in [`CHANGELOG.md`](https://github.com/tposella/featherkeeper/blob/main/CHANGELOG.md) as you work
   (Added / Changed / Fixed). If people need to do or check anything when they update, put it in a
   **Before you update** section at the top of the version's notes (see below).
2. Bump the version: `node scripts/bump-version.mjs patch` (or `minor`). This updates both
   `package.json` files and lockfiles, and turns "Unreleased" into the new version's section.
3. Commit and push to `main`.

The [release workflow](https://github.com/tposella/featherkeeper/blob/main/.github/workflows/release.yml) then tags `v<version>`, builds and publishes
the Docker images to `ghcr.io/tposella/featherkeeper-{api,web,identifier}` (tagged with the version and
`latest`), and creates the GitHub release with that version's notes. Sites with update checks on show
their admin an "Update available" badge within a few hours.

The [version check](https://github.com/tposella/featherkeeper/blob/main/.github/workflows/version-check.yml) fails a push that changes the app (server
or web code, Dockerfiles, `docker-compose.yml`) without a new version, or that bumps the version with
no CHANGELOG section. Docs, tests and CI changes don't need a version.

## Upgrade notes and breaking changes

Updating should be `docker compose pull && docker compose up -d` and nothing else. When a release
needs more (a setting that changes meaning or default, a one-off command, a new `docker-compose.yml`,
a database change that can't be rolled back), it says so in two places:

- a `### Before you update` section at the top of the version's CHANGELOG notes, which the release
  notes and the in-app update alert show first;
- an entry under [Upgrade notes](updating.md#upgrade-notes) in these docs.

The rules for those changes:

- **Patch versions (x.y.Z)** never need anything beyond pulling the new images.
- **Minor versions (x.Y.0)** may change defaults or need a step, and always say so up front. Until 1.0,
  a minor version can also remove or rename a setting, with the old name still read for at least one
  minor version.
- Database changes only ever add migrations; a shipped migration is never edited.

## How sites learn about updates

The version badge in the top bar, right of the Featherkeeper logo, shows the running version to
everyone. For site admins, the server checks GitHub's public releases list every few hours; when a
newer version is out the badge turns gold and opens to the release notes and the update command:

```bash
cd /opt/featherkeeper && docker compose pull && docker compose up -d
```

Set `UPDATE_CHECK=false` in `.env` to switch the check off. It sends GitHub nothing but the request
itself: no site address, no data about your site or its users.
