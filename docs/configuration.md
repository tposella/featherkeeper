# Configuration

All settings live in `.env` in the install folder (every one is documented in
[`example.env`](https://github.com/tposella/featherkeeper/blob/main/.env.example)). Changing one takes
effect after `docker compose up -d`.

| Setting | Default | What it does |
| --- | --- | --- |
| **Site** | | |
| `PUBLIC_URL` | `http://localhost:8080` | The address people use. `https://` turns on secure cookies |
| `WEB_PORT` | `8080` | Port the web container listens on, on the host |
| `ALLOW_REGISTRATION` | `false` | Sign-ups before you choose in the admin page: `false` = invite links only, `true` = anyone (the first account is always allowed and becomes admin) |
| `DEFAULT_QUOTA_MB` | `0` | Photo storage limit per account in MB (0 = none); also set in the admin page |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | empty | Create the admin on first start instead of registering in the browser |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `TRUST_PROXY` | private networks | Which proxies may pass on the visitor's address: by default those on private networks (your nginx, cloudflared, Docker). `false`, a hop count, or a list of addresses/CIDRs also work |
| `COOKIE_SECURE` | on for `https://` | Force secure cookies on or off |
| `LOG_LEVEL` | `info` | API log detail: `debug`, `info`, `warn`, `error` |
| `FEATHERKEEPER_TAG` | `latest` | Which release `docker compose pull` fetches, e.g. `0.1.0` to stay on it |
| `UPDATE_CHECK` | `true` | Tell site admins (version badge in the top bar) when a newer release is on GitHub |
| `UPDATE_CHECK_REPO` | `tposella/featherkeeper` | Where to look for releases (for forks) |
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
