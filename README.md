# Featherkeeper

**A self-hosted birding log that works like a pokédex.** Build a checklist of the birds that live
around you, log every sighting, keep an album of your photos for each species, and see at a glance
which birds you've photographed and which you're still looking for.

Featherkeeper runs on your own server (a Proxmox LXC, a Raspberry Pi, any Linux box with Docker).
Your photos and records stay with you. The only outside services it talks to are public birding and
mapping databases, and each of them can be switched off.

> **Status: public beta (0.1.0-beta).** Featherkeeper is usable day to day, but it's new: expect
> rough edges and changes between releases, and **keep backups** (see
> [Updating, backups and restoring](#updating-backups-and-restoring); you can also download any
> catalogue as a ZIP from its Settings). Found a bug or have an idea?
> [Open an issue](https://github.com/tposella/featherkeeper/issues/new/choose). What changed in each
> release is in the [CHANGELOG](CHANGELOG.md).
>
> Try the demo with sample data: **https://tposella.github.io/featherkeeper/**

---

## Contents

- [Why Featherkeeper](#why-featherkeeper)
- [Features](#features)
- [What's in this repository](#whats-in-this-repository)
- [How it fits together](#how-it-fits-together)
- [Install](#install)
  - [Requirements](#requirements)
  - [Quick start with Docker](#quick-start-with-docker)
  - [Installing in a Proxmox LXC](#installing-in-a-proxmox-lxc)
  - [Putting it on the internet (reverse proxy, Cloudflare Tunnel)](#putting-it-on-the-internet)
  - [Turning on AI identification](#turning-on-ai-identification)
- [Configuration reference](#configuration-reference)
- [Updating, backups and restoring](#updating-backups-and-restoring)
- [Accounts and password resets](#accounts-and-password-resets)
- [Troubleshooting](#troubleshooting)
- [Privacy: what leaves your server](#privacy-what-leaves-your-server)
- [Development](#development)
- [API overview](#api-overview)
- [Credits and sources](#credits-and-sources)
- [Licence](#licence)

---

## Why Featherkeeper

Bird photographers tend to keep their "life list" in a spreadsheet, a notes app, or their memory.
Featherkeeper turns that into something more fun and more useful:

- **A dex to fill.** Start with every species recorded near your town and watch the grid fill in as you
  photograph them. Birds you haven't photographed yet show as greyed-out example photos (or empty
  frames, if you prefer), and your own photos fill them in full colour.
- **Help finding the next one.** See what's around this month, when in the year and what time of day
  each bird is usually photographed nearby, its habitat, and where it was reported in the last 30 days.
- **Your photos, organised.** Every photo is filed under its species with its date, place and camera
  details read from the file.
- **Shareable, on your terms.** Keep a catalogue private, share it with signed-in friends, or make it
  public for anyone with the link.

## Features

**Catalogues and sharing**
- Several catalogues per site (your backyard, a local park, a whole province), each with an **owner**
  and any number of **editors**.
- Per-catalogue visibility: **Private** (owner and editors), **Signed-in users**, or **Public**.
- Option to **hide exact locations** from viewers, for nest sites, sensitive species or your home.
  Hidden locations also hide original photo files, because those carry GPS.

**Building the species list**
- **Import from eBird** in two ways:
  - *Around a town or place:* search a town or click the map, choose a distance (5 to 50 km), and get
    every species recorded at the eBird hotspots in that circle.
  - *A whole region:* a province, state, county or country by its eBird code (e.g. `CA-AB`).
- Preview the list with checkboxes before anything is saved. Add species by hand at any time.

**The dex**
- A grid in field-guide (taxonomic) order with plate numbers (#001, #002...).
- Species you haven't photographed show as **greyed examples** by default, like a pokédex: an openly
  licensed example photo in grey, replaced by your own photo in full colour once you add one. You can
  switch to **empty slots** instead. Owners set the default in Settings, and anyone can switch on the Dex
  tab. Your server fetches the example photos in the background as soon as species are added, and at
  startup for any still missing. It stores them in the database as small WebP files with the
  photographer's credit and serves them from there.
- Filter by **Photographed / Not yet**, search by name or number, and filter by family.
- **Families** view: progress per bird family (ducks, owls, woodpeckers...) with mini plates for every
  species, sortable by "most left to photograph" or "closest to complete".
- **In season** view: birds reported nearby in the last 30 days and birds usually photographed there in
  any chosen month, with unphotographed species first. Rarities reported nearby but missing from your
  catalogue are listed separately, with an "Add to catalogue" button.

**Species pages**
- Your **album** of every photo of that bird, with a chosen **thumbnail** (or "always use my newest").
- Mark a subpar photo as **want to replace**, with an optional note ("backlit", "only the tail"). The
  **To replace** tab (editors only) lists those photos. It shows when you've added a newer photo of the
  same species since, and lets you unmark the old photo, delete it, or log a new sighting.
- **When and where to find it:** month-of-year and time-of-day charts from nearby observations, habitat
  from Wikipedia, recent eBird reports with places, and a summary of your own sightings.
- **Calls and songs:** openly licensed recordings with players, labelled song or call where known,
  nearest to your area first.
- Notes, and every sighting with **edit** and **delete**.

**Logging sightings**
- Add photos (JPEG, HEIC from iPhones, PNG, WebP, TIFF or AVIF, up to 100 MB each by default). **Date, time, GPS and
  camera** are read from each photo. The place name is filled in from the nearest eBird hotspot, or from
  OpenStreetMap.
- **Search for a place** by name (hotspots near your catalogue first), click the map, or use your
  device's location.
- **AI identification (optional):** the top 3 matches with confidence bars, each with example photos and
  a side-by-side compare view. Suggestions are weighted by what eBird has recorded where the photo was
  taken. You **accept** or **reject** them; your decision is saved with the photo.

**Maps and history**
- Map of all sightings, and a recent-sightings feed.

**Look and feel**
- Works on phones: a bottom navigation bar with a raised **Log** button and a **More** sheet, a compact
  header, full-screen photo viewing with swipe, and finger-sized buttons. Desktop keeps the tabs.
- Light and dark mode. Follows your system setting by default, with a toggle in the header that your
  browser remembers.

**Running it**
- Ready-made Docker images for x86-64 and ARM, and one `docker compose up` on any Linux host. Works
  behind nginx, Caddy, Traefik or a Cloudflare Tunnel.
- **Export** any catalogue as a ZIP (CSV spreadsheets plus original photos), and admin password resets
  in the app or from the server console.
- Automatic database migrations, health checks, a smoke-test script and a backup script.

## What's in this repository

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
│   ├── smoke-test.sh           End-to-end check of a running install
│   ├── backup.sh               Database dump and photo backup, keeps the last 14
│   └── nginx.example.conf      Server block for an nginx reverse proxy in front of Featherkeeper
├── docs/
│   └── ai-identification.md    How AI identification works, its accuracy, and its options
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

## Install

### Requirements

| | Minimum | Notes |
| --- | --- | --- |
| Host | Any 64-bit Linux with **Docker Engine 24+** and the **Compose v2** plugin | A Proxmox LXC, VM, NAS or Raspberry Pi 4/5 all work |
| RAM | 1 GB | **4 GB** if you turn on AI identification (it uses about 2.3 GB) |
| Disk | 2 GB plus your photos | Plus about 8 GB for the AI image and model |
| eBird API key | Free, recommended | Needed for species import, hotspots and recent sightings. Get one at **https://ebird.org/api/keygen** |
| xeno-canto key | Free, optional | Adds labelled, quality-rated recordings. From your xeno-canto account page |

### Quick start with Docker

```bash
git clone https://github.com/tposella/featherkeeper.git /opt/featherkeeper
cd /opt/featherkeeper
cp .env.example .env
openssl rand -hex 24          # copy this: it becomes your database password
nano .env
```

Set at least these in `.env`:

| Setting | Example |
| --- | --- |
| `PUBLIC_URL` | `http://192.168.1.50:8080` (the address you'll open; change to `https://...` later) |
| `POSTGRES_PASSWORD` | the random string from `openssl` |
| `EBIRD_API_KEY` | your eBird key |

Then start it with the ready-made images:

```bash
docker compose pull
docker compose up -d
docker compose ps             # db, api and web should say "healthy" after a minute or two
```

The images come from the GitHub Container Registry (`ghcr.io/tposella/featherkeeper-*`), built for
x86-64 and 64-bit ARM (the AI identifier is x86-64 only). `FEATHERKEEPER_TAG` in `.env` picks the
release: `beta` (the newest, the default), `latest` (the newest stable one), or an exact version such as
`0.1.0-beta.1`. To build the images yourself from this folder instead, use
`docker compose up -d --build`.

Open `http://<server-ip>:8080` and **create your account. The first account becomes the site admin**,
so do this before anyone else can reach the site. Then choose **New catalogue → Around a town or place**,
search for your town, and pick your starting species.

Optional check that everything works end to end (it creates a throwaway "Smoke test" catalogue):

```bash
./deploy/smoke-test.sh
```

### Installing in a Proxmox LXC

1. Create a Debian 12 LXC (unprivileged is fine). Under **Options → Features** turn on **nesting** and
   **keyctl**, which Docker needs inside an LXC. Give it 1 GB of RAM, or 4 GB for AI identification.
2. In the LXC console, install Docker and git:
   ```bash
   apt update && apt install -y curl git
   curl -fsSL https://get.docker.com | sh
   ```
3. Follow the [quick start](#quick-start-with-docker).
4. **Photos on a separate disk (recommended):** add a mount point to the LXC (e.g. `/mnt/photos`), run
   `chown 1000:1000 /mnt/photos`, and set `PHOTOS_DIR=/mnt/photos` in `.env` **before** uploading photos.
   They then survive rebuilding the LXC and can be backed up separately.
5. **Never expose the Docker TCP socket** (port 2375/2376). Featherkeeper doesn't need it; manage it from
   the LXC's shell.

Proxmox's own documentation recommends running Docker in a VM rather than an LXC. Docker in an LXC
works well in practice, but if a Proxmox update ever breaks it, a small VM is the drop-in alternative.

### Putting it on the internet

The `web` container speaks plain HTTP on port 8080. Put any reverse proxy in front of it:

- **nginx:** use [`deploy/nginx.example.conf`](deploy/nginx.example.conf). The important line is
  `client_max_body_size 110m;`, because nginx's default 1 MB limit rejects photos.
- **Cloudflare Tunnel:** point a public hostname at your nginx, or straight at `http://<lxc-ip>:8080`.
  Cloudflare's Free plan caps uploads at **100 MB per request**, which is why `MAX_UPLOAD_MB` defaults
  to 100.
- **Caddy / Traefik:** a plain reverse proxy to port 8080 works; just raise the request body limit.

Once the site is reached over HTTPS, set `PUBLIC_URL=https://your.domain` in `.env` and run
`docker compose up -d`. This turns on secure cookies, so signing in then only works over HTTPS.
If you don't want strangers creating accounts, set `ALLOW_REGISTRATION=false` (after your editors
have registered).

### Turning on AI identification

In `.env`:

```
COMPOSE_PROFILES=ai
IDENTIFY_PROVIDER=bioclip
```

Then `docker compose pull && docker compose up -d` and watch `docker compose logs -f identifier` until it says
`ready`. The first start downloads the model (a few GB, one time). Details, measured accuracy and
options are in [docs/ai-identification.md](docs/ai-identification.md).

## Configuration reference

All settings live in `.env` (see [`.env.example`](.env.example)). Changing one takes effect after
`docker compose up -d`.

| Setting | Default | What it does |
| --- | --- | --- |
| **Site** | | |
| `PUBLIC_URL` | `http://localhost:8080` | The address people use. `https://` turns on secure cookies |
| `WEB_PORT` | `8080` | Port the web container listens on, on the host |
| `ALLOW_REGISTRATION` | `true` | Let anyone create an account (the first account is always allowed and becomes admin) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | empty | Create the admin on first start instead of registering in the browser |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-*` headers from your reverse proxy |
| `COOKIE_SECURE` | on for `https://` | Force secure cookies on or off |
| `LOG_LEVEL` | `info` | API log detail: `debug`, `info`, `warn`, `error` |
| **Database** | | |
| `POSTGRES_USER`, `POSTGRES_DB` | `featherkeeper` | Database user and name |
| `POSTGRES_PASSWORD` | (required) | Database password. Only read when the database is first created |
| **Photos** | | |
| `PHOTOS_DIR` | Docker volume | A host folder for photos, owned by uid 1000 |
| `MAX_UPLOAD_MB` | `100` | Largest photo upload; `0` means no limit |
| **eBird** | | |
| `EBIRD_API_KEY` | empty | Free key from ebird.org/api/keygen. Empty switches eBird features off |
| **Place search** | | |
| `GEOCODER_URL` | OpenStreetMap Nominatim | Your own Nominatim server, or empty to switch place search off |
| **Species information** | | |
| `REFERENCE_PHOTOS` | `true` | Example photos next to AI suggestions and in the greyed-examples dex view |
| `SPECIES_INSIGHTS` | `true` | "In season" and "When and where to find it" |
| `SPECIES_SOUNDS` | `true` | "Calls and songs" |
| `XENO_CANTO_API_KEY` | empty | Adds xeno-canto recordings (labelled song or call) |
| **AI identification** | | |
| `COMPOSE_PROFILES` | empty | `ai` starts the identifier container |
| `IDENTIFY_PROVIDER` | `none` | `bioclip` (bundled model) or `http` (your own service) |
| `IDENTIFIER_MODEL` | `hf-hub:imageomics/bioclip-2` | `hf-hub:imageomics/bioclip` is smaller and faster, less accurate |
| `IDENTIFIER_THREADS` | all cores | CPU threads the model may use |
| `IDENTIFIER_TEMPERATURE` | `1.0` | Above 1 makes confidence values less extreme |
| `IDENTIFY_URL`, `IDENTIFY_API_KEY` | empty | For `IDENTIFY_PROVIDER=http` |
| `IDENTIFY_TIMEOUT_MS` | `180000` | How long the API waits for an identification |

## Updating, backups and restoring

**Update:**
```bash
cd /opt/featherkeeper && git pull && docker compose pull && docker compose up -d
```
`git pull` brings the latest `docker-compose.yml` and scripts; `docker compose pull` fetches the
images for your `FEATHERKEEPER_TAG`. (If you build your own images, use `git pull && docker compose up -d --build`.)
Database migrations run automatically on start. Hard-refresh the browser afterwards (Ctrl+Shift+R).
Read the [CHANGELOG](CHANGELOG.md) before updating to see what's new.

**Export a catalogue:** its **Settings → Export** downloads a ZIP with spreadsheets (CSV) of the
checklist, sightings and photos, and every original photo file in a folder per species. Owners and
editors can do this at any time; it doesn't replace server backups, but it's an easy copy to keep.

**Back up** (database dump plus photos into a dated folder; keeps the 14 newest):
```bash
./deploy/backup.sh /mnt/backups/featherkeeper
```
To run it nightly, add this with `crontab -e`:
```
15 3 * * * cd /opt/featherkeeper && ./deploy/backup.sh /mnt/backups/featherkeeper >> /var/log/featherkeeper-backup.log 2>&1
```
A Proxmox vzdump of the LXC is a good second layer.

**Restore** a backup into a fresh install (after `docker compose up -d` has created empty containers):
```bash
B=/mnt/backups/featherkeeper/2026-10-22_0315
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$B/database.dump"
docker compose exec -T api tar -C /data -xf - < "$B/photos.tar"
docker compose restart api
```

## Accounts and password resets

The first account created becomes the **site admin**. There's no email on a Featherkeeper site, so
forgotten passwords are reset by an admin:

- **In the app:** go to **Account → manage users and reset passwords**. **Reset password** either makes
  a temporary password (shown once, for you to pass on) or lets you type one. The user is signed out
  everywhere and can change it under **Account** after signing in. You can also make other people
  site admins there.
- **From the server's console** (for when the admin is the one locked out), in the folder with
  `docker-compose.yml`:

  ```bash
  docker compose exec api node src/admin-cli.js list-users
  docker compose exec api node src/admin-cli.js reset-password you@example.com
  docker compose exec api node src/admin-cli.js reset-password you@example.com --password "a new password"
  docker compose exec api node src/admin-cli.js make-admin you@example.com
  ```

  `reset-password` prints a temporary password unless you give one, and signs that account out
  everywhere.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| A container isn't `healthy` | `docker compose logs api` (or `db`, `web`, `identifier`) shows why |
| Can't sign in after switching to HTTPS | `PUBLIC_URL` must be the `https://` address, and your proxy must send `X-Forwarded-Proto` |
| Photo uploads fail with "413" | Raise `client_max_body_size` in your reverse proxy (110m for the default 100 MB limit) |
| "Cannot reach the identifier container" | Set `COMPOSE_PROFILES=ai` in `.env` (note the `=`), then `docker compose up -d` |
| "No date or location found" for a photo | The file has no metadata: messaging apps and some exports strip it. Enter the details by hand |
| A HEIC (iPhone) photo shows no preview while logging | Normal in most browsers other than Safari: it uploads and displays fine once saved |
| Locked out of the admin account | `docker compose exec api node src/admin-cli.js reset-password you@example.com` (see [Accounts](#accounts-and-password-resets)) |
| eBird import says the key was rejected | Check `EBIRD_API_KEY` in `.env`, then `docker compose up -d` |
| Map or place search is empty | The server or browser can't reach OpenStreetMap; check the network or set `GEOCODER_URL` |

## Privacy: what leaves your server

Featherkeeper never uploads your photos to an outside service. The AI model runs locally, and it only
ever sees a shrunk copy with all metadata removed. Outbound requests are lookups:

| Service | What is sent | Switch off with |
| --- | --- | --- |
| eBird | Region codes, approximate coordinates (rounded to about 1 km), species codes, your API key | Empty `EBIRD_API_KEY` |
| iNaturalist | Scientific names, approximate coordinates of the catalogue area | `SPECIES_INSIGHTS`, `SPECIES_SOUNDS`, `REFERENCE_PHOTOS` = `false` |
| Wikipedia | Species names | `SPECIES_INSIGHTS=false` |
| xeno-canto | Scientific names, country, your API key | Empty `XENO_CANTO_API_KEY` |
| OpenStreetMap Nominatim | Place searches, and coordinates to name a place | Empty `GEOCODER_URL` |

Visitors' browsers also load map tiles from OpenStreetMap, and the example photos next to AI suggestions
and recordings straight from iNaturalist, Wikimedia and xeno-canto, so those sites see the visitor's IP
address, as with any embedded image. The dex's greyed example photos are the exception: your server
downloads them once and serves them itself.

## Development

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
| `web-demo.yml` | Builds the demo, runs browser tests (including photo metadata), takes screenshots of every screen, and publishes to GitHub Pages |

Each workflow pushes its logs and screenshots to a `ci-report*` branch for review.

**Database changes:** add a new numbered file in `apps/api/src/db/migrations/`. Never edit one that has
shipped.

## API overview

All endpoints are under `/api` and return JSON. Sign-in uses an HTTP-only session cookie.
Viewing follows each catalogue's visibility; changes need the owner or an editor.

| Area | Endpoints |
| --- | --- |
| System | `GET /health`, `GET /config` |
| Accounts | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me` |
| Site admin | `GET /admin/users`, `POST /admin/users/:id/reset-password`, `PATCH /admin/users/:id` |
| Catalogues | `GET /catalogues`, `POST /catalogues`, `GET`/`PATCH`/`DELETE /catalogues/:slug`, `GET /catalogues/:slug/export.zip` |
| Members | `GET`/`POST /catalogues/:slug/members`, `PATCH`/`DELETE /catalogues/:slug/members/:userId` |
| Dex | `GET`/`POST /catalogues/:slug/species`, `GET`/`PATCH`/`DELETE /catalogues/:slug/species/:id`, `GET /species?q=` |
| Species info | `GET /catalogues/:slug/species/:id/insights`, `GET /catalogues/:slug/species/:id/sounds`, `GET /reference` |
| Season | `GET /catalogues/:slug/season?month=` |
| eBird import | `POST /ebird/preview`, `POST /catalogues/:slug/import/ebird` |
| Places | `GET /places?q=&catalogue=`, `GET /places/reverse?latitude=&longitude=` |
| Sightings | `GET`/`POST /catalogues/:slug/sightings`, `PATCH`/`DELETE /sightings/:id` |
| Photos | `POST /sightings/:id/photos`, `GET /photos/:id/thumb\|display\|original`, `PATCH`/`DELETE /photos/:id`, `GET /catalogues/:slug/to-replace`, `POST /photo-info` |
| AI | `POST /catalogues/:slug/identify` |

---

## Credits and sources

Featherkeeper stands on the work of many people and organisations. Thank you.

### Data services

| Service | Used for | Terms and licence |
| --- | --- | --- |
| **[eBird](https://ebird.org)** / [eBird API 2.0](https://documenter.getpostman.com/view/664302/S1ENwy59), Cornell Lab of Ornithology | Species lists for regions and hotspots, nearby hotspots, recent sightings, taxonomy, region names | [eBird API Terms of Use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/): non-commercial use, attribute eBird.org with a link. Featherkeeper shows this in its footer and wherever eBird data appears |
| **[iNaturalist](https://www.inaturalist.org)** / [iNaturalist API](https://api.inaturalist.org/v1/docs/), California Academy of Sciences and National Geographic Society | Monthly and hourly observation counts, species usually photographed by month, example photos, sound recordings | [Terms of Use](https://www.inaturalist.org/pages/terms). Each photo and recording carries its own Creative Commons licence; only openly licensed media are shown, always with the creator's attribution |
| **[xeno-canto](https://xeno-canto.org)** / xeno-canto API v3 | Song and call recordings (optional, with your key) | Each recording carries its own Creative Commons licence, shown with the recordist's name and a link |
| **[Wikipedia](https://en.wikipedia.org)** / [MediaWiki Action API](https://www.mediawiki.org/wiki/API:Main_page) and [Wikimedia REST API](https://en.wikipedia.org/api/rest_v1/) | Habitat text; fallback example photos | Text under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), shown with a link to the article. Images from [Wikimedia Commons](https://commons.wikimedia.org) under their own licences |
| **[OpenStreetMap](https://www.openstreetmap.org)** | Map tiles | Data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); tiles under the [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) |
| **[Nominatim](https://nominatim.org)** | Place search and naming places from coordinates | © OpenStreetMap contributors, ODbL; [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) (Featherkeeper sends at most one request per second, with an identifying User-Agent) |

Recommended citations:

> eBird. 2026. eBird: An online database of bird distribution and abundance [web application].
> eBird, Cornell Lab of Ornithology, Ithaca, New York. Available: http://www.ebird.org.
>
> Sullivan, B.L., C.L. Wood, M.J. Iliff, R.E. Bonney, D. Fink, and S. Kelling. 2009. eBird: a
> citizen-based bird observation network in the biological sciences. *Biological Conservation* 142:
> 2282–2292.

### AI model

| Work | Used for | Licence |
| --- | --- | --- |
| **[BioCLIP 2](https://huggingface.co/imageomics/bioclip-2)**, Imageomics Institute | Bird identification (the default model) | MIT |
| **[BioCLIP](https://huggingface.co/imageomics/bioclip)**, Imageomics Institute | Smaller alternative model | MIT |
| **[OpenCLIP](https://github.com/mlfoundations/open_clip)** | Loading and running the model | MIT |
| **[Hugging Face Hub](https://huggingface.co)** | Hosting the model weights | |

> Gu, J., Stevens, S., Campolongo, E. G., Thompson, M. J., Zhang, N., Wu, J., Kopanev, A., Mai, Z.,
> White, A. E., Balhoff, J., Dahdul, W., Rubenstein, D., Lapp, H., Berger-Wolf, T., Chao, W.-L., and
> Su, Y. 2025. BioCLIP 2: Emergent Properties from Scaling Hierarchical Contrastive Learning.
> *NeurIPS 2025*. [arXiv:2505.23883](https://arxiv.org/abs/2505.23883)
>
> Stevens, S., Wu, J., Thompson, M. J., Campolongo, E. G., Song, C. H., Carlyn, D. E., Dong, L.,
> Dahdul, W. M., Stewart, C., Berger-Wolf, T., Chao, W.-L., and Su, Y. 2024. BioCLIP: A Vision
> Foundation Model for the Tree of Life. *CVPR 2024*.
>
> Ilharco, G., Wortsman, M., Wightman, R., Gordon, C., Carlini, N., Taori, R., Dave, A., Shankar, V.,
> Namkoong, H., Miller, J., Hajishirzi, H., Farhadi, A., and Schmidt, L. 2021. OpenCLIP. Zenodo.
> [doi:10.5281/zenodo.5143773](https://doi.org/10.5281/zenodo.5143773)
>
> Radford, A., et al. 2021. Learning Transferable Visual Models From Natural Language Supervision.
> *ICML 2021*.

### Libraries: API (`apps/api`)

| Library | Used for | Licence |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | Runtime | MIT |
| [Fastify](https://fastify.dev) | Web framework | MIT |
| [@fastify/cookie](https://github.com/fastify/fastify-cookie) | Session cookies | MIT |
| [@fastify/multipart](https://github.com/fastify/fastify-multipart) | Photo uploads | MIT |
| [@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit) | Rate limiting | MIT |
| [node-postgres (pg)](https://node-postgres.com) | PostgreSQL client | MIT |
| [sharp](https://sharp.pixelplumbing.com) (with [libvips](https://www.libvips.org), LGPL-3.0) | Thumbnails, display images, image validation | Apache-2.0 |
| [exifr](https://github.com/MikeKovarik/exifr) | Reading date, GPS and camera from photos | MIT |
| [libheif](https://github.com/strukturag/libheif) (`heif-dec`, with [libde265](https://github.com/strukturag/libde265)) | Decoding HEIC (iPhone) photos, in the API image | LGPL-3.0 |

### Libraries: web app (`apps/web`)

| Library | Used for | Licence |
| --- | --- | --- |
| [Vue](https://vuejs.org) | User interface | MIT |
| [Vue Router](https://router.vuejs.org) | Page routing | MIT |
| [Vite](https://vite.dev) and [@vitejs/plugin-vue](https://github.com/vitejs/vite-plugin-vue) | Build tooling | MIT |
| [Leaflet](https://leafletjs.com) | Maps | BSD-2-Clause |
| [exifr](https://github.com/MikeKovarik/exifr) | Reading photo metadata in the browser | MIT |
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) by Mathieu Triay, via [Fontsource](https://fontsource.org) | Display typeface | SIL Open Font License 1.1 (Fontsource packaging: MIT) |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) by the Braille Institute, via [Fontsource](https://fontsource.org) | Body typeface | SIL Open Font License 1.1 (Fontsource packaging: MIT) |

### Libraries: AI identifier (`services/identifier`)

| Library | Used for | Licence |
| --- | --- | --- |
| [Python](https://www.python.org) | Runtime | PSF License |
| [PyTorch](https://pytorch.org) and [torchvision](https://github.com/pytorch/vision) (CPU builds) | Running the model | BSD-3-Clause |
| [open_clip_torch](https://github.com/mlfoundations/open_clip) | Model loading and inference | MIT |
| [FastAPI](https://fastapi.tiangolo.com) | HTTP service | MIT |
| [Uvicorn](https://www.uvicorn.org) | HTTP server | BSD-3-Clause |
| [python-multipart](https://github.com/Kludex/python-multipart) | Upload parsing | Apache-2.0 |
| [Pillow](https://python-pillow.org) | Image loading | MIT-CMU (HPND) |
| [NumPy](https://numpy.org) | Scoring maths | BSD-3-Clause |

### Infrastructure

| Software | Used for | Licence |
| --- | --- | --- |
| [Docker](https://www.docker.com) and [Docker Compose](https://docs.docker.com/compose/) | Packaging and running the stack | Apache-2.0 |
| [PostgreSQL 16](https://www.postgresql.org) (`postgres:16-alpine`) | Database | PostgreSQL License |
| [nginx](https://nginx.org) (`nginx:1.27-alpine`) | Serving the web app, proxying the API | BSD-2-Clause |
| [Debian](https://www.debian.org) and [Alpine Linux](https://alpinelinux.org) base images | Container operating systems | Various open-source licences |

### Development and CI tools

| Tool | Used for | Licence |
| --- | --- | --- |
| [GitHub Actions](https://github.com/features/actions) and [GitHub Pages](https://pages.github.com) | CI and the public demo | |
| [Playwright](https://playwright.dev) with Chromium | Browser tests and screenshots | Apache-2.0 |
| [ExifTool](https://exiftool.org) by Phil Harvey | Creating test photos with camera metadata | Perl (Artistic/GPL) |
| [ImageMagick](https://imagemagick.org) | Creating test images | ImageMagick License |
| [wait-on](https://github.com/jeffbski/wait-on) | Waiting for the preview server in CI | MIT |

Accuracy tests use the lead photos of English Wikipedia species articles, under their respective
licences, downloaded at test time and not redistributed.

Featherkeeper is an independent project. It is not affiliated with or endorsed by the Cornell Lab of
Ornithology, iNaturalist, the Xeno-canto Foundation, the Wikimedia Foundation, the OpenStreetMap
Foundation or the Imageomics Institute.

## Licence

Featherkeeper is free software, licensed under the **GNU Affero General Public License v3.0**
([AGPL-3.0](LICENSE)). You may use, study, share and modify it. If you run a modified version as a
service for others, you must make your modified source code available to them under the same licence.
