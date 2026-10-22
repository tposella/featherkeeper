# Featherkeeper

A self-hosted birding log that works like a pokédex. Keep catalogues of the species in your area, log sightings, upload your photos, and see at a glance which birds you have photographed and which you are still looking for.

> **Status: early development (v0.1).** Usable, but expect changes.

## Try the demo

Every push to `main` builds the frontend with sample data and publishes it to GitHub Pages:
**https://tposella.github.io/featherkeeper/**

The demo needs no server. Use the banner at the top to view it as the owner, an editor, or a signed-out visitor. Photos are placeholders and changes reset when you reload.

## Deploy with Docker

Featherkeeper runs as three containers (web, API, Postgres) on any Linux host with Docker,
including a Proxmox LXC. Only the web port (8080) is published.

```bash
git clone https://github.com/tposella/featherkeeper.git /opt/featherkeeper
cd /opt/featherkeeper
cp .env.example .env
nano .env                       # set PUBLIC_URL, POSTGRES_PASSWORD, EBIRD_API_KEY
docker compose up -d --build
```

Open `http://<server-ip>:8080` and create your account: the first account becomes the site admin.

- **Update:** `git pull && docker compose up -d --build`
- **Logs:** `docker compose logs -f api`
- **Check everything works:** `./deploy/smoke-test.sh` (after creating your admin account)
- **Back up:** `./deploy/backup.sh /path/to/backups` (database dump + photos)
- **Reverse proxy:** see [`deploy/nginx.example.conf`](deploy/nginx.example.conf). Once the site is reached over
  HTTPS, set `PUBLIC_URL` to the `https://` address and run `docker compose up -d`.

All settings are documented in [`.env.example`](.env.example).

## Develop

```bash
# Frontend only, with sample data
cd apps/web && npm install && VITE_DEMO=true npm run dev     # http://localhost:5173

# API (needs Postgres, e.g. docker run -p 5432:5432 -e POSTGRES_PASSWORD=featherkeeper -e POSTGRES_USER=featherkeeper postgres:16)
cd apps/api && npm install && npm run dev
cd apps/web && npm run dev                                    # proxies /api to localhost:3000
```

## Features

- Multiple catalogues per site, each with an owner and editors
- Per-catalogue visibility: private, signed-in users, or public
- Species import from eBird for any region, plus manual entry
- Photo uploads with EXIF date, camera and GPS
- Map of sightings, with an option to hide locations
- Optional AI identification (BioCLIP 2, runs on your own CPU): top 3 matches with confidence, weighted by what eBird has recorded where the photo was taken. See [docs/ai-identification.md](docs/ai-identification.md)
- One `docker compose up` to deploy on any Linux host or Proxmox LXC
