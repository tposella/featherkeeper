# Troubleshooting

| Symptom | Fix |
| --- | --- |
| A container isn't `healthy` | `docker compose logs api` (or `db`, `web`, `identifier`) shows why |
| Can't sign in after switching to HTTPS | `PUBLIC_URL` must be the `https://` address, and your proxy must send `X-Forwarded-Proto` |
| Photo uploads fail with "413" | Raise `client_max_body_size` in your reverse proxy (110m for the default 100 MB limit) |
| "Cannot reach the identifier container" | Set `COMPOSE_PROFILES=ai` in `.env` (note the `=`), then `docker compose up -d` |
| "No date or location found" for a photo | The file has no metadata: messaging apps and some exports strip it. Enter the details by hand |
| A HEIC (iPhone) photo shows no preview while logging | Normal in most browsers other than Safari: it uploads and displays fine once saved |
| Locked out of the admin account | `docker compose exec api node src/admin-cli.js reset-password you@example.com` (see [Accounts](admin.md#from-the-servers-console)) |
| eBird import says the key was rejected | Check `EBIRD_API_KEY` in `.env`, then `docker compose up -d` |
| Map or place search is empty | The server or browser can't reach OpenStreetMap; check the network or set `GEOCODER_URL` |

Still stuck? [Open an issue](https://github.com/tposella/featherkeeper/issues/new/choose) with what
you tried and the output of `docker compose logs api`. Remove anything private (your email, keys,
addresses) from logs before posting them.
