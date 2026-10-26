# Development

## What's in the repository

```
featherkeeper/
├── apps/
│   ├── api/                    Node.js API (Fastify + PostgreSQL)
│   │   ├── src/
│   │   │   ├── server.js       Startup: wait for the database, migrate, create the admin, listen
│   │   │   ├── admin-cli.js    Console commands: list users, reset a password, make an admin
│   │   │   ├── app.js          Builds the Fastify app and wires the services together
│   │   │   ├── config.js       Every setting, read from environment variables
│   │   │   ├── db/             Connection pool, migration runner, SQL migrations
│   │   │   ├── routes/         HTTP endpoints (auth, catalogues, dex, sightings, eBird, season, ...)
│   │   │   ├── integrations/   eBird, iNaturalist, Wikipedia, xeno-canto, OpenStreetMap, AI identifier
│   │   │   └── lib/            Permissions, image processing and EXIF, storage, candidates for AI
│   │   ├── test/               Unit, API and live-service tests (node:test)
│   │   └── Dockerfile
│   └── web/                    Vue 3 single-page app (Vite)
│       ├── src/
│       │   ├── views/          Pages: catalogues, dex, families, in season, species, log, map, settings
│       │   ├── components/     Area picker, location picker, AI suggestions, album picker, charts...
│       │   └── demo/           In-browser fake API and sample data for the GitHub Pages demo
│       ├── scripts/            Screenshot and browser-test script used in CI
│       ├── nginx.conf          Serves the app and forwards /api to the API container
│       └── Dockerfile
├── services/
│   └── identifier/             Optional Python service running BioCLIP 2 for AI identification
│       ├── app.py              FastAPI app: scores a photo against candidate species
│       ├── eval/               Accuracy check against real bird photos (run in CI)
│       └── Dockerfile
├── deploy/
│   ├── install.sh              The one-line installer (also attached to every release)
│   ├── smoke-test.sh           End-to-end check of a running install
│   ├── backup.sh               Database dump and photo backup, keeps the last 14
│   └── nginx.example.conf      Server block for an nginx reverse proxy in front of Featherkeeper
├── docs/                       This documentation site (MkDocs), published with the demo
├── mkdocs.yml                  Documentation site settings
├── scripts/
│   └── bump-version.mjs        Bumps the version everywhere and starts the CHANGELOG section
├── .github/
│   ├── workflows/              CI (API tests, Docker stack test, AI accuracy, demo + screenshots)
│   │                           and the release workflow that publishes images to ghcr.io
│   └── ISSUE_TEMPLATE/         Bug report and feature idea forms
├── docker-compose.yml          The whole stack
├── .env.example                Every setting, documented
├── CHANGELOG.md                What changed in each release
├── SECURITY.md                 How to report a security problem privately
└── LICENSE                     GNU Affero General Public License v3.0
```

## How it fits together

```
 Browser ──HTTPS──▶ Cloudflare Tunnel / your reverse proxy (optional)
                         │
                         ▼
 ┌──────────────────── Docker Compose stack ───────────────────────────────┐
 │  web  (nginx + the built Vue app, port 8080)                             │
 │    │  /api/*                                                             │
 │    ▼                                                                     │
 │  api  (Node.js + Fastify) ─── db  (PostgreSQL 16)                        │
 │    │        └──────────────── photos volume (originals + display + thumb)│
 │    └──▶ identifier  (Python + BioCLIP 2, optional "ai" profile)          │
 └──────────────────────────────────────────────────────────────────────────┘
      │ outbound, read-only lookups (each can be switched off):
      ├─ eBird API 2.0 ............ species lists, hotspots, recent sightings, taxonomy
      ├─ iNaturalist API .......... seasonal counts, time of day, example photos, sounds
      ├─ Wikipedia API ............ habitat text
      ├─ xeno-canto API ........... song and call recordings (only with your key)
      └─ OpenStreetMap Nominatim .. place search and place names
   The browser loads map tiles from OpenStreetMap, and example photos and sound files
   from iNaturalist, Wikimedia and xeno-canto.
```

Only the `web` container publishes a port. The database, API and identifier are reachable only
inside the stack.

## Running it locally

```bash
# Frontend only, with sample data and no server (the same build as the GitHub Pages demo)
cd apps/web && npm install && VITE_DEMO=true npm run dev        # http://localhost:5173

# Full stack for development
docker run -d --name fk-db -p 5432:5432 -e POSTGRES_USER=featherkeeper \
  -e POSTGRES_PASSWORD=featherkeeper -e POSTGRES_DB=featherkeeper postgres:16
cd apps/api && npm install && npm run dev                       # API on :3000
cd apps/web && npm run dev                                      # proxies /api to :3000

# API tests (needs a database named featherkeeper_test; it is wiped on each run)
docker exec fk-db createdb -U featherkeeper featherkeeper_test
cd apps/api && npm test
```

**Continuous integration** (GitHub Actions, in `.github/workflows/`):

| Workflow | What it does |
| --- | --- |
| `api.yml` | API unit and integration tests against PostgreSQL 16, plus live tests against eBird (if the `EBIRD_API_KEY` repository secret is set), iNaturalist and Wikipedia |
| `docker.yml` | Builds the images, starts the stack exactly as a self-hoster would, and runs `deploy/smoke-test.sh`, including a real eBird import and a 45 MB photo upload |
| `ai.yml` | Runs BioCLIP 2 on real bird photos and reports accuracy, speed and memory |
| `web-demo.yml` | Builds the demo and this documentation, runs browser tests (including photo metadata), takes screenshots of every screen, and publishes both to GitHub Pages |
| `install.yml` | Runs the installer on a fresh machine (and again, to check it keeps settings), from the checkout and from the latest release's downloads |
| `version-check.yml`, `release.yml` | Check every app change has a new version, and publish the release when its tests pass |

Each workflow pushes its logs and screenshots to a `ci-report*` branch for review.

**Database changes:** add a new numbered file in `apps/api/src/db/migrations/`. Never edit one that has
shipped.

Versions and releases are covered in [Releasing](releasing.md).

## API overview

All endpoints are under `/api` and return JSON. Sign-in uses an HTTP-only session cookie.
Viewing follows each catalogue's visibility; changes need the owner or an editor.

| Area | Endpoints |
| --- | --- |
| System | `GET /health`, `GET /config` |
| Accounts | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me` |
| Site admin | `GET /admin/users`, `POST /admin/users/:id/reset-password`, `PATCH`/`DELETE /admin/users/:id`, `GET /admin/users/:id/owned`, `GET`/`PATCH /admin/settings`, `GET`/`POST /admin/invites`, `DELETE /admin/invites/:id`, `POST /admin/taxonomy/refresh` |
| Your account | `GET /auth/me/account`, `DELETE /auth/me`, `GET /auth/invite/:token` |
| Catalogues | `GET /catalogues`, `POST /catalogues`, `GET`/`PATCH`/`DELETE /catalogues/:slug`, `GET /catalogues/:slug/export.zip` |
| Members | `GET`/`POST /catalogues/:slug/members`, `PATCH`/`DELETE /catalogues/:slug/members/:userId` |
| Dex | `GET`/`POST /catalogues/:slug/species`, `GET`/`PATCH`/`DELETE /catalogues/:slug/species/:id`, `GET /species?q=` |
| Species info | `GET /catalogues/:slug/species/:id/insights`, `GET /catalogues/:slug/species/:id/sounds`, `GET /reference` |
| Season | `GET /catalogues/:slug/season?month=` |
| eBird import | `POST /ebird/preview`, `POST /catalogues/:slug/import/ebird` |
| Places | `GET /places?q=&catalogue=`, `GET /places/reverse?latitude=&longitude=` |
| Sightings | `GET`/`POST /catalogues/:slug/sightings`, `PATCH`/`DELETE /sightings/:id` |
| Photos | `POST /sightings/:id/photos`, `GET /photos/:id/thumb\|display\|original`, `PATCH`/`DELETE /photos/:id`, `GET /catalogues/:slug/to-replace`, `POST /photo-info`, `POST /catalogues/:slug/photos/check` |
| AI | `POST /catalogues/:slug/identify` |

Contributions are welcome: open an issue first for anything large, so we can agree on the approach.
