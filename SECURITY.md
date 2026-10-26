# Security policy

Featherkeeper is a self-hosted app that stores people's photos and the places they were taken, so
security reports are very welcome.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Instead, report it privately through
GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**
(<https://github.com/tposella/featherkeeper/security/advisories/new>).

Please include:

- what the problem is and what someone could do with it;
- the steps to reproduce it, and the Featherkeeper version (shown in the site's footer and at `/api/health`);
- anything about your setup that matters (reverse proxy, Cloudflare Tunnel, settings in `.env`).

You'll get a reply within a week. Once it's fixed, a release goes out with a note in the
[CHANGELOG](CHANGELOG.md), and you'll be credited unless you'd rather not be.

## Supported versions

Featherkeeper is in early releases (0.x), so only the **newest release** gets security fixes. Keep up
to date with `docker compose pull && docker compose up -d` in the install folder (see
[Updating](https://tposella.github.io/featherkeeper/docs/updating/)).

## Good practice when you run it

- Use HTTPS when the site is reachable from the internet (set `PUBLIC_URL` to the `https://` address),
  and keep the containers' ports private behind your reverse proxy.
- Create the admin account before anyone else can reach the site, and turn off `ALLOW_REGISTRATION`
  if you don't want strangers making accounts.
- Use **Hide exact locations** on public catalogues with nest sites or sensitive species.
- Keep backups (`deploy/backup.sh`) and use a long random `POSTGRES_PASSWORD`.
