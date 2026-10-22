# Featherkeeper

A self-hosted birding log that works like a pokédex. Keep catalogues of the species in your area, log sightings, upload your photos, and see at a glance which birds you have photographed and which you are still looking for.

> **Status: early development.** The frontend is being designed first, using a demo mode with sample data. The API, database and Docker deployment follow.

## Try the demo

Every push to `main` builds the frontend with sample data and publishes it to GitHub Pages:
**https://tyler-posella.github.io/featherkeeper/**

The demo needs no server. Use the banner at the top to view it as the owner, an editor, or a signed-out visitor. Photos are placeholders and changes reset when you reload.

## Run the frontend locally

```bash
cd apps/web
npm install
VITE_DEMO=true npm run dev
```

Then open http://localhost:5173.

## Planned features

- Multiple catalogues per site, each with an owner and editors
- Per-catalogue visibility: private, signed-in users, or public
- Species import from eBird for any region, plus manual entry
- Photo uploads with EXIF date, camera and GPS
- Map of sightings, with an option to hide locations
- Optional AI species suggestions from a photo
- One `docker compose up` to deploy on any Linux host or Proxmox LXC
