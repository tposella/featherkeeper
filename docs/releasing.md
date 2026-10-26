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

1. Note what changed under `## [Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md) as you work
   (Added / Changed / Fixed).
2. Bump the version: `node scripts/bump-version.mjs patch` (or `minor`). This updates both
   `package.json` files and lockfiles, and turns "Unreleased" into the new version's section.
3. Commit and push to `main`.

The [release workflow](../.github/workflows/release.yml) then tags `v<version>`, builds and publishes
the Docker images to `ghcr.io/tposella/featherkeeper-{api,web,identifier}` (tagged with the version and
`latest`), and creates the GitHub release with that version's notes. Sites with update checks on show
their admin an "Update available" badge within a few hours.

The [version check](../.github/workflows/version-check.yml) fails a push that changes the app (server
or web code, Dockerfiles, `docker-compose.yml`) without a new version, or that bumps the version with
no CHANGELOG section. Docs, tests and CI changes don't need a version.

## How sites learn about updates

The version badge in the bottom-left corner (in the footer on phones) shows the running version to
everyone. For site admins, the server checks GitHub's public releases list every few hours; when a
newer version is out the badge turns gold and opens to the release notes and the update command:

```bash
cd /opt/featherkeeper && git pull && docker compose pull && docker compose up -d
```

Set `UPDATE_CHECK=false` in `.env` to switch the check off. It sends GitHub nothing but the request
itself (no site address beyond the user agent, no data about your site or its users).
