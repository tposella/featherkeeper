# Accounts and admin

The first account created becomes the **site admin**. Under **Account → Site admin** they can:

- choose **who can sign up**: by **invite link** (the default; each link works once and expires) or
  **anyone**;
- see **disk space** and each account's **photo storage**, and set a storage limit for everyone or for
  one person;
- **reset passwords** (a temporary password shown once, or one you type), make other people admins,
  and **delete accounts**;
- check **species names** against eBird's latest taxonomy.

Anyone can **delete their own account** under **Account**. Catalogues they own are deleted with it
(export them first, or make an editor the owner); sightings they logged in other people's catalogues
stay. The last site admin can't be deleted.


## From the server's console

There's no email on a Featherkeeper site, so forgotten passwords are reset by an admin. **From the
server's console** (for when the admin is the one locked out), in the folder with `docker-compose.yml`:

```bash
docker compose exec api node src/admin-cli.js list-users
docker compose exec api node src/admin-cli.js reset-password you@example.com
docker compose exec api node src/admin-cli.js reset-password you@example.com --password "a new password"
docker compose exec api node src/admin-cli.js make-admin you@example.com
docker compose exec api node src/admin-cli.js fix-photo-times --timezone America/New_York --dry-run
```

`reset-password` prints a temporary password unless you give one, and signs that account out
everywhere. `fix-photo-times` corrects photos uploaded before 0.1.2 whose camera recorded no time zone.
