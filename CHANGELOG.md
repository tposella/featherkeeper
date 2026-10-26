# Changelog

What changed in each release of Featherkeeper. Versions are `x.y.z`: a smaller change bumps the last
number (0.1.0 → 0.1.1), a bigger one the middle (0.1 → 0.2). See [docs/releasing.md](docs/releasing.md).

## [Unreleased]

## [0.2.0] - 2026-10-26

Ready for a public site: invite-only sign-ups, account and storage management, bulk upload, and
security hardening.

### Added
- **Invite-only sign-ups** (now the default): the site admin makes invite links (each works once and
  expires) or opens sign-ups to anyone, under **Account → Site admin**.
- **Delete accounts:** anyone can delete their own account (with their password); admins can delete
  any account. Catalogues the account owns are deleted with it.
- **Storage:** the admin page shows free disk space and each account's photo storage, and can set a
  storage limit for everyone or per person. Your own usage shows under Account.
- **Bulk upload:** add a shoot's photos at once, give each a species (typed, "Same for next", or AI
  suggestions), and save. Photos of the same species within 30 minutes become one sighting.
- **Duplicate warnings** when a photo you're adding is already in the catalogue (by file fingerprint;
  older photos are fingerprinted in the background after updating).
- **eBird taxonomy refresh:** species names, families and field-guide order follow eBird's yearly
  updates (checked monthly, or on demand from the admin page). Species eBird has retired (splits and
  lumps) are listed for review.

### Changed
- **Every sighting needs a photo.** Deleting a sighting's last photo deletes the sighting.
- The Recent tab loads 50 sightings at a time, and the map only loads sightings with a location, so
  large catalogues open quickly.
- `ALLOW_REGISTRATION` now defaults to `false` (invite links). If your `.env` says `true`, sign-ups stay
  open until you choose in the admin page.
- Releases wait for that commit's tests to pass before they're published.

### Security
- Security headers on every page and API response: no framing by other sites (clickjacking), no
  content-type sniffing, a stricter referrer policy, and camera and microphone access turned off.

## [0.1.2] - 2026-10-26

### Fixed
- **Security:** the login rate limit could be dodged by making up an address in the `X-Forwarded-For`
  header. Only proxies on private networks (your nginx, cloudflared, Docker) are trusted to pass on the
  visitor's address now. If your `.env` sets `TRUST_PROXY=true`, it now means the same safe default.
- **Photo times** from cameras that don't record a time zone (many DSLRs) were read as UTC, so they
  showed hours off. They're now read in the uploader's time zone. To correct photos uploaded before
  this release, run once on the server:
  `docker compose exec api node src/admin-cli.js fix-photo-times --timezone America/Vancouver`
  (use your own time zone; add `--dry-run` to preview).
- An expired sign-in now takes you to the sign-in page (and back afterwards) instead of every action
  failing with "Sign in required".
- Large exports stream straight through nginx instead of being copied to a temporary file first,
  which could fill the web container's disk.

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

[Unreleased]: https://github.com/tposella/featherkeeper/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/tposella/featherkeeper/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/tposella/featherkeeper/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/tposella/featherkeeper/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tposella/featherkeeper/compare/v0.1.0-beta.1...v0.1.0
[0.1.0-beta.1]: https://github.com/tposella/featherkeeper/releases/tag/v0.1.0-beta.1
