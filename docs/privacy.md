# Privacy

## No telemetry

Featherkeeper has **no telemetry**. It sends no analytics, usage statistics, crash reports or
"phone home" pings, to the project or anyone else. There's no account with us, no licence check and no
tracking in the web app. Nothing about your site, your users or your birds leaves your server except
the lookups listed below, and each of those can be switched off.

Your photos are never uploaded to an outside service. The AI model runs on your own server, and it
only ever sees a shrunk copy with all metadata removed.

## What leaves your server

| Service | What is sent | Why | Switch off with |
| --- | --- | --- | --- |
| eBird | Region codes, approximate coordinates (rounded to about 1 km), species codes, your API key | Species lists, hotspots, recent sightings, taxonomy updates | Empty `EBIRD_API_KEY` |
| iNaturalist | Scientific names, approximate coordinates of the catalogue area | Seasonal charts, example photos, sounds | `SPECIES_INSIGHTS`, `SPECIES_SOUNDS`, `REFERENCE_PHOTOS` = `false` |
| Wikipedia | Species names | Habitat text | `SPECIES_INSIGHTS=false` |
| xeno-canto | Scientific names, country, your API key | Song and call recordings | Empty `XENO_CANTO_API_KEY` |
| OpenStreetMap Nominatim | Place searches, and coordinates to name a place | Place search and place names | Empty `GEOCODER_URL` (or point it at your own Nominatim) |
| GitHub | A request for the list of Featherkeeper releases, every few hours | Update alerts for the admin | `UPDATE_CHECK=false` |

The update check asks GitHub's public API for the release list and nothing else: it doesn't send your
site's address, version or anything about your users.

## What visitors' browsers load

Visitors' browsers load map tiles from OpenStreetMap, and the example photos next to AI suggestions
and the recordings straight from iNaturalist, Wikimedia and xeno-canto, so those sites see the
visitor's IP address, as with any embedded image. The dex's greyed example photos are the exception:
your server downloads them once and serves them itself.

## Locations

Photos carry GPS. A catalogue's **Hide exact locations** setting hides coordinates and original photo
files from viewers who aren't owners or editors, for nest sites, sensitive species or your home.
Exports include GPS, so they're only available to owners and editors.
