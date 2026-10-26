# Updating and backups

## Updating

**First, read the [upgrade notes](#upgrade-notes)** for every version between yours and the new one.
Then, in the install folder:

```bash
cd /opt/featherkeeper
docker compose pull && docker compose up -d
```

That fetches the images for your `FEATHERKEEPER_TAG` (`latest` by default) and restarts on them.
Database changes run by themselves on start. Hard-refresh the browser afterwards (Ctrl+Shift+R).

When a release changes `docker-compose.yml` itself, its notes say so. Run the installer again to get
the new file; it keeps your `.env`, database and photos (and saves your old compose file as
`docker-compose.yml.previous`):

```bash
curl -fsSL https://github.com/tposella/featherkeeper/releases/latest/download/install.sh | sudo bash
```

If you downloaded the files yourself instead, download `docker-compose.yml` again from the
[latest release](https://github.com/tposella/featherkeeper/releases/latest). If you run from a clone
of the repository: `git pull && docker compose pull && docker compose up -d` (or `--build` if you build
your own images).

**Staying on a version:** set `FEATHERKEEPER_TAG=0.2.1` (for example) in `.env`. `docker compose pull`
and the installer then stay on that version until you change it, or run the installer with
`--version X.Y.Z`.

**Going back:** set `FEATHERKEEPER_TAG` to the previous version and `docker compose up -d`. Database
changes aren't undone, so if a release's notes say it changes the database, restore the
[backup](#backups) you took before updating.

## Versions and update alerts

Every update has an `x.y.z` version: 0.1.0 → 0.1.1 for a smaller change, 0.1 → 0.2 for a bigger one.
The running version shows in the top bar, next to the logo. For site admins, the server checks
GitHub's releases every few hours, and the badge turns gold with the new version, its release notes
and the update command when one is out. Switch the check off with `UPDATE_CHECK=false`.

What changed in each release is in the
[CHANGELOG](https://github.com/tposella/featherkeeper/blob/main/CHANGELOG.md) and on the
[releases page](https://github.com/tposella/featherkeeper/releases).

## Upgrade notes

Most updates need nothing beyond `docker compose pull && docker compose up -d`. These are the ones
that need you to do or check something. Each release that needs one also has a **Before you update**
section in its notes.

### 0.2.1

Nothing to do. Installs can now be made without the repository (see [Install](install.md)); an
existing install from a clone keeps working as it is.

### 0.2.0

- **Sign-ups are invite-only by default.** `ALLOW_REGISTRATION` now defaults to `false`. If your `.env`
  doesn't set it and you relied on open sign-ups, open them again under **Account → Site admin**.
- **Every sighting needs a photo** from now on. Existing sightings without photos stay, and deleting a
  sighting's last photo now deletes the sighting.
- After updating, older photos are fingerprinted in the background for duplicate warnings. On a large
  catalogue this uses some disk reads for a while.

### 0.1.2

- **Photo times:** photos from cameras that record no time zone (many DSLRs) uploaded before 0.1.2
  were read as UTC. Correct them once, with your own time zone (`--dry-run` previews):
  ```bash
  docker compose exec api node src/admin-cli.js fix-photo-times --timezone America/New_York --dry-run
  docker compose exec api node src/admin-cli.js fix-photo-times --timezone America/New_York
  ```
- `TRUST_PROXY=true` now means "proxies on private networks". If your reverse proxy is on a public
  address, list it in `TRUST_PROXY` instead.

## Export a catalogue

A catalogue's **Settings → Export** downloads a ZIP with spreadsheets (CSV) of the checklist,
sightings and photos, and every original photo file in a folder per species. Owners and editors can
do this at any time. It doesn't replace server backups, but it's an easy copy to keep, and it's
readable without Featherkeeper.

## Backups

`backup.sh` (in the install folder; `deploy/backup.sh` in a clone) writes a database dump and the
photos into a dated folder, and keeps the 14 newest:

```bash
cd /opt/featherkeeper && ./backup.sh /mnt/backups/featherkeeper
```

To run it nightly, add this with `crontab -e`:

```
15 3 * * * cd /opt/featherkeeper && ./backup.sh /mnt/backups/featherkeeper >> /var/log/featherkeeper-backup.log 2>&1
```

Keep backups on a different disk or machine. A Proxmox vzdump of the LXC is a good second layer.

## Restoring

Into a fresh install (after `docker compose up -d` has created empty containers):

```bash
B=/mnt/backups/featherkeeper/2026-10-22_0315
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$B/database.dump"
docker compose exec -T api tar -C /data -xf - < "$B/photos.tar"
docker compose restart api
```

Use the same or a newer Featherkeeper version than the backup was made with.
