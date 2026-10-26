# Changelog

What changed in each release of Featherkeeper. Versions are `x.y.z`: a smaller change bumps the last
number (0.1.0 → 0.1.1), a bigger one the middle (0.1 → 0.2). See [docs/releasing.md](docs/releasing.md).

## [Unreleased]

## [0.1.1] - 2026-10-26

### Changed
- The version badge and update alert moved to the top bar, right of the Featherkeeper logo, so it no
  longer floats over the page. Its details open below it.

## [0.1.0] - 2026-10-26

The first numbered release after the beta, and from here on every update gets a version.

### Added
- **Version badge** in the bottom-left corner (in the footer on phones) showing the running version.
- **Update alerts** for site admins: the server checks GitHub's releases every few hours, and the badge
  turns gold with the new version, its release notes and the update command. `UPDATE_CHECK=false`
  switches it off.
- `scripts/bump-version.mjs` and a release guide ([docs/releasing.md](docs/releasing.md)); pushing a
  version bump to `main` publishes the release automatically.
- A version check in CI: app changes need a new version and a CHANGELOG entry.

### Changed
- Versions are now plain `x.y.z` (no `-beta`). `FEATHERKEEPER_TAG` defaults to `latest`; the `beta`
  image tag still follows the newest release, so existing installs keep updating.
- `/api/health` includes the version.

## [0.1.0-beta.1] - 2026-10-25

The first public beta.

### Catalogues and sharing
- Several catalogues per site, each with an owner and editors, and visibility set to private,
  signed-in users or public. Exact locations can be hidden from viewers.
- Build a catalogue's species list from eBird: around a town or place (5 to 50 km), or a whole region.

### The dex
- A field-guide-order grid with plate numbers, filters (photographed / not yet), search and family filter.
- **Greyed examples** (the default): species you haven't photographed show an openly licensed example
  photo in grey; your own photos fill them in full colour. Switch to empty slots on the Dex tab or in Settings.
- Families view, and an **In season** view of what's been reported nearby and what's usually around.

### Species pages
- An album of your photos with a chosen thumbnail, and **To replace** marks (with notes) for photos
  you'd like to improve, listed on their own tab.
- When and where to find it: month and time-of-day charts (hover or tap a bar for counts and
  percentages), habitat, recent eBird reports and your own records.
- Calls and songs from xeno-canto and iNaturalist.

### Logging
- Photo uploads up to 100 MB, including **HEIC photos from iPhones**. Date, time, GPS and camera
  are read from each photo; the place is named from the nearest eBird hotspot or OpenStreetMap.
- Optional AI identification (BioCLIP 2) with a location-aware top 3, example photos and a compare view.
- Edit or move sightings to another species.

### Running it
- **Ready-made Docker images** on the GitHub Container Registry, for x86-64 and ARM
  (the AI identifier is x86-64 only). `docker compose pull && docker compose up -d`.
- **Export** any catalogue as a ZIP: CSV spreadsheets of the checklist, sightings and photos, plus
  every original photo.
- **Password resets** by the site admin in the app, or from the server console
  (`docker compose exec api node src/admin-cli.js reset-password <email>`).
- Light and dark mode, and a phone layout with bottom navigation and swipeable photos.
- Backup and smoke-test scripts, automatic database migrations.

[Unreleased]: https://github.com/tposella/featherkeeper/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/tposella/featherkeeper/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tposella/featherkeeper/compare/v0.1.0-beta.1...v0.1.0
[0.1.0-beta.1]: https://github.com/tposella/featherkeeper/releases/tag/v0.1.0-beta.1
