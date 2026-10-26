# Install

Featherkeeper runs as a small Docker Compose stack: a web container (nginx and the app), an API
container, PostgreSQL, and an optional AI identifier. You don't need to clone the repository or build
anything: each release publishes ready-made images and the few files you need.

## Requirements

| | Minimum | Notes |
| --- | --- | --- |
| Host | Any 64-bit Linux with **Docker Engine 24+** and the **Compose v2** plugin | A Proxmox LXC, VM, NAS or Raspberry Pi 4/5 all work |
| RAM | 1 GB | **4 GB** if you turn on AI identification (it uses about 2.3 GB) |
| Disk | 2 GB plus your photos | Plus about 8 GB for the AI image and model |
| eBird API key | Free, recommended | Needed for species import, hotspots and recent sightings. Get one at **<https://ebird.org/api/keygen>** |
| xeno-canto key | Free, optional | Adds labelled, quality-rated recordings. From your xeno-canto account page |

## Option 1: the installer (Debian and Ubuntu)

```bash
curl -fsSL https://github.com/tposella/featherkeeper/releases/latest/download/install.sh | sudo bash
```

It installs Docker if it's missing, puts Featherkeeper in `/opt/featherkeeper`, writes a `.env` with a
random database password, downloads the images and starts them. It prints the address to open when
it's done. You can read the script first: it's
[`deploy/install.sh`](https://github.com/tposella/featherkeeper/blob/main/deploy/install.sh) in the
repository, and the same file is attached to every release.

Options go after `bash -s --`:

```bash
curl -fsSL https://github.com/tposella/featherkeeper/releases/latest/download/install.sh \
  | sudo bash -s -- --url https://birds.example.com --ebird-key YOUR_KEY --ai
```

| Option | What it does |
| --- | --- |
| `--dir DIR` | Where to install (default `/opt/featherkeeper`) |
| `--port PORT` | Web port on this machine (default `8080`) |
| `--url URL` | The address people will use (default `http://<this machine's IP>:<port>`) |
| `--ebird-key KEY` | Your eBird API key |
| `--version X.Y.Z` | Install a specific release instead of the newest, and stay on it |
| `--ai` | Also run the AI identifier |
| `--no-docker-install` | Don't install Docker (it must already be there) |
| `--yes` | Don't ask before starting |

Running the installer again is safe: it updates `docker-compose.yml` and the images, and keeps your
`.env`, database and photos.

## Option 2: download the files yourself

Any Linux machine with Docker and Compose:

```bash
mkdir -p /opt/featherkeeper && cd /opt/featherkeeper
curl -fsSLO https://github.com/tposella/featherkeeper/releases/latest/download/docker-compose.yml
curl -fsSL  https://github.com/tposella/featherkeeper/releases/latest/download/example.env -o .env
curl -fsSLO https://github.com/tposella/featherkeeper/releases/latest/download/backup.sh && chmod +x backup.sh
chmod 600 .env
openssl rand -hex 24          # copy this: it becomes your database password
nano .env
```

Set at least these in `.env`:

| Setting | Example |
| --- | --- |
| `PUBLIC_URL` | `http://192.168.1.50:8080` (the address you'll open; change to `https://...` later) |
| `POSTGRES_PASSWORD` | the random string from `openssl` |
| `EBIRD_API_KEY` | your eBird key |

Then start it:

```bash
docker compose pull
docker compose up -d
docker compose ps             # db, api and web should say "healthy" after a minute or two
```

The images come from the GitHub Container Registry (`ghcr.io/tposella/featherkeeper-*`), built for
x86-64 and 64-bit ARM (the AI identifier is x86-64 only). `FEATHERKEEPER_TAG` in `.env` picks the
release: `latest` (the default) or an exact version such as `0.2.1` to stay on it.

!!! tip "Building from source"
    To build the images yourself, clone the repository and run `docker compose up -d --build` in it.
    See [Development](development.md).

## First steps

Open the address and **create your account. The first account becomes the site admin**, so do this
before anyone else can reach the site. Then choose **New catalogue → Around a town or place**, search
for your town, and pick your starting species.

New accounts after the first are **invite-only** by default: send people an invite link from
**Account → Site admin**, or switch sign-ups to "Anyone" there. See [Accounts and admin](admin.md).

## Proxmox LXC

1. Create a Debian 12 LXC (unprivileged is fine). Under **Options → Features** turn on **nesting** and
   **keyctl**, which Docker needs inside an LXC. Give it 1 GB of RAM, or 4 GB for AI identification.
2. In the LXC console, run the [installer](#option-1-the-installer-debian-and-ubuntu).
3. **Photos on a separate disk (recommended):** add a mount point to the LXC (e.g. `/mnt/photos`), run
   `chown 1000:1000 /mnt/photos`, and set `PHOTOS_DIR=/mnt/photos` in `.env` **before** uploading
   photos, then `docker compose up -d`. They then survive rebuilding the LXC and can be backed up
   separately.
4. **Never expose the Docker TCP socket** (port 2375/2376). Featherkeeper doesn't need it.

Proxmox's own documentation recommends running Docker in a VM rather than an LXC. Docker in an LXC
works well in practice, but if a Proxmox update ever breaks it, a small VM is the drop-in alternative.

## Putting it on the internet

The `web` container speaks plain HTTP on port 8080. Put any reverse proxy in front of it:

- **nginx:** use
  [`deploy/nginx.example.conf`](https://github.com/tposella/featherkeeper/blob/main/deploy/nginx.example.conf).
  The important line is `client_max_body_size 110m;`, because nginx's default 1 MB limit rejects photos.
- **Cloudflare Tunnel:** point a public hostname at your nginx, or straight at `http://<server-ip>:8080`.
  Cloudflare's Free plan caps uploads at **100 MB per request**, which is why `MAX_UPLOAD_MB` defaults
  to 100.
- **Caddy / Traefik:** a plain reverse proxy to port 8080 works; just raise the request body limit.

Once the site is reached over HTTPS, set `PUBLIC_URL=https://your.domain` in `.env` and run
`docker compose up -d`. This turns on secure cookies, so signing in then only works over HTTPS.

## Turning on AI identification

In `.env`:

```
COMPOSE_PROFILES=ai
IDENTIFY_PROVIDER=bioclip
```

Then `docker compose pull && docker compose up -d` and watch `docker compose logs -f identifier` until
it says `ready`. The first start downloads the model (a few GB, one time). Details, measured accuracy
and options are in [AI identification](ai-identification.md).

## Checking it works

The repository's smoke test checks a running install end to end (it creates a throwaway "Smoke test"
catalogue). Run it in the folder with `docker-compose.yml`:

```bash
cd /opt/featherkeeper
curl -fsSLO https://raw.githubusercontent.com/tposella/featherkeeper/main/deploy/smoke-test.sh
bash smoke-test.sh
# once there are accounts and sign-ups are invite-only, sign in as yourself:
SMOKE_EMAIL=you@example.com SMOKE_PASSWORD='your password' bash smoke-test.sh
```
