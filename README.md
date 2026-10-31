# Featherkeeper

**A self-hosted birding log that works like a pokédex.** Build a checklist of the birds that live
around you, log every sighting, keep an album of your photos for each species, and see at a glance
which birds you've photographed and which you're still looking for.

You run it on your own server, the way you'd run Immich or Jellyfin: a Proxmox LXC, a Raspberry Pi,
a NAS or any Linux machine with Docker. Your photos and records stay with you.

**[Documentation](https://tposella.github.io/featherkeeper/docs/)** ·
**[Live demo](https://tposella.github.io/featherkeeper/)** ·
[Releases](https://github.com/tposella/featherkeeper/releases) ·
[Changelog](CHANGELOG.md) ·
[Report a bug](https://github.com/tposella/featherkeeper/issues/new/choose)

![The dex: photographed species in colour, the rest as greyed example photos](docs/images/dex.png)

> **Early releases (0.x).** Usable day to day, but new: expect changes between releases, read the
> [upgrade notes](https://tposella.github.io/featherkeeper/docs/updating/#upgrade-notes) before
> updating, and keep backups.

## Quick start

On Debian or Ubuntu (an LXC, a VM or a spare machine), one line installs Docker if needed, sets
Featherkeeper up in `/opt/featherkeeper` with a random database password, and starts it:

```bash
curl -fsSL https://github.com/tposella/featherkeeper/releases/latest/download/install.sh | sudo bash
```

Or on any Linux machine with Docker, download the two files and start it yourself:

```bash
mkdir -p /opt/featherkeeper && cd /opt/featherkeeper
curl -fsSLO https://github.com/tposella/featherkeeper/releases/latest/download/docker-compose.yml
curl -fsSL  https://github.com/tposella/featherkeeper/releases/latest/download/example.env -o .env
nano .env        # set PUBLIC_URL, POSTGRES_PASSWORD (openssl rand -hex 24) and EBIRD_API_KEY
docker compose up -d
```

Then open `http://<server-ip>:8080` and create your account: **the first account becomes the site
admin**. A free [eBird API key](https://ebird.org/api/keygen) turns on species import, hotspots and
recent sightings.

Everything else (requirements, Proxmox, reverse proxies and Cloudflare Tunnel, AI identification,
every setting, updating, backups) is in the
**[documentation](https://tposella.github.io/featherkeeper/docs/install/)**.

## Features

- **A dex to fill:** every species recorded near your town, in field-guide order. Birds you haven't
  photographed show as greyed example photos until your own photo fills them in.
- **eBird import** around a town or for a whole region, with a preview before anything is saved.
- **Species pages** with your album, "want to replace" marks, when and where each bird is usually
  seen nearby, habitat, and calls and songs.
- **Logging from photos:** date, time, GPS and camera are read from each file (JPEG, iPhone HEIC, PNG,
  WebP, TIFF, AVIF). Bulk upload a whole shoot, with duplicate warnings.
- **Families** and **In season** views to see what's left and what's around this month, with a switch
  to show only the birds tied to this time of year.
- **Optional AI identification** that runs on your own server (BioCLIP 2), weighted by what's been
  recorded where the photo was taken.
- **Catalogues you can share:** private, signed-in users or public, with editors, and an option to
  hide exact locations.
- **Self-hosting comforts:** images for x86-64 and ARM, invite-only sign-ups, storage limits, update
  alerts, ZIP export, a backup script, and password resets from the console.
- Works on phones, with light and dark mode.

| Species page | Families | On a phone |
| --- | --- | --- |
| ![Species page](docs/images/species.png) | ![Families](docs/images/families.png) | ![Phone](docs/images/phone-dex.png) |

## No telemetry

Featherkeeper doesn't phone home. There are no analytics, usage statistics or crash reports, and no
account with the project. Your photos never leave your server. The only outside requests are lookups
to public birding and mapping databases (eBird, iNaturalist, Wikipedia, xeno-canto, OpenStreetMap)
and a check for new releases on GitHub, each of which can be switched off. Details:
[privacy](https://tposella.github.io/featherkeeper/docs/privacy/).

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/tposella/featherkeeper/issues). To
run it from source, see [development](https://tposella.github.io/featherkeeper/docs/development/).
Security problems: see [SECURITY.md](SECURITY.md).

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
