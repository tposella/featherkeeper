# AI photo identification

Featherkeeper can suggest which species a photo shows. It is off by default and runs entirely
on your own hardware: the photo never leaves your server.

## How it works

1. You choose a photo on **Log a sighting**. It is shrunk to 1024 px and stripped of metadata.
2. Featherkeeper works out where it was taken: the map pin on the form, otherwise the photo's
   GPS, otherwise the catalogue's area.
3. It asks eBird which species have been recorded within 25 km of that spot, and which of those
   were reported in the last 30 days. Each candidate gets a prior:

   | Candidate | Prior |
   | --- | --- |
   | Seen within 25 km in the last 30 days | 1.0 |
   | Recorded within 25 km at any time | 0.4 |
   | In the catalogue but not recorded near there | 0.08 |

   With no location, every species in the catalogue gets 1.0.
4. The identifier compares the photo with each candidate's name using
   [BioCLIP 2](https://huggingface.co/imageomics/bioclip-2) (MIT licence), turns the similarities
   into probabilities, multiplies them by the priors, and returns the ranking.
5. You see the top 3 (more on request) with a confidence bar and **Accept** or **Reject**.
   Accepting selects the species, adding it to the catalogue if needed. The suggestions and
   your decision are saved with the photo.

## Turn it on

In `.env`:

```
COMPOSE_PROFILES=ai
IDENTIFY_PROVIDER=bioclip
```

Then `docker compose up -d --build`. The first start downloads the model into the `models`
volume; `docker compose logs -f identifier` shows when it is ready.

## What to expect

Measured in CI on a 4-core runner with no GPU (see the `AI identification` workflow):

- About 2 seconds per photo. The first photo after the species list changes takes longer
  (about 30 seconds for ~280 species) while every name is encoded; that work is cached on disk.
- About 2.3 GB of RAM at peak for the identifier container.
- 25 of 25 common Alberta species identified correctly from the lead photo of their Wikipedia
  article.

That test set is easy: sharp, frame-filling photos, some of which the model may have seen during
training. Your photos of distant, backlit or partly hidden birds will do worse. Cropping tightly
around the bird helps the most.

Confidence values from this kind of model run high. If they feel overconfident, set
`IDENTIFIER_TEMPERATURE=2` (or higher) in `.env` to spread them out; the ranking does not change.

## Options

| Setting | Default | Meaning |
| --- | --- | --- |
| `IDENTIFIER_MODEL` | `hf-hub:imageomics/bioclip-2` | `hf-hub:imageomics/bioclip` is smaller and faster but less accurate |
| `IDENTIFIER_THREADS` | all cores | CPU threads the model may use |
| `IDENTIFIER_TEMPERATURE` | `1.0` | Above 1 makes confidences less extreme |
| `IDENTIFY_TIMEOUT_MS` | `180000` | How long the API waits for an answer |

## Using another service (`IDENTIFY_PROVIDER=http`)

Set `IDENTIFY_URL` (and `IDENTIFY_API_KEY` if needed). Featherkeeper sends
`POST multipart/form-data` with the photo in the `image` field and expects JSON:

```json
{ "predictions": [{ "scientificName": "Turdus migratorius", "commonName": "American Robin", "confidence": 0.91 }] }
```

`confidence` may be 0–1 or 0–100. This provider does not receive candidates or priors.
