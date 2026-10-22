#!/usr/bin/env bash
# Checks a running Featherkeeper stack end to end: web page, API health, sign-up,
# catalogue creation, (optionally) a real eBird import, and a photo upload.
#
#   ./deploy/smoke-test.sh [base-url]      default http://localhost:8080
#
# It creates a throwaway account and catalogue. Run it on a fresh install, or delete
# the "Smoke test" catalogue afterwards. Requires curl; run from the repo folder.
set -euo pipefail

BASE="${1:-http://localhost:8080}"
JAR="$(mktemp)"
IMG="$(mktemp --suffix=.jpg)"
trap 'rm -f "$JAR" "$IMG"' EXIT
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }

# POST JSON and print the body; fail on a non-2xx status.
post() {
  local out status
  out=$(curl -sS -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' -X POST "$BASE$1" -d "$2" -w '\n%{http_code}')
  status=${out##*$'\n'}
  [[ $status == 2* ]] || fail "POST $1 -> HTTP $status: ${out%$'\n'*}"
  printf '%s' "${out%$'\n'*}"
}

echo "Checking $BASE"

curl -fsS "$BASE/" | grep -q '<title>Featherkeeper</title>' && pass "web page loads" || fail "web page"
curl -fsS "$BASE/api/health" | grep -q '"ok"' && pass "API and database are healthy" || fail "API health"

config=$(curl -fsS "$BASE/api/config")
echo "  info config: $config"
# The first account on a site becomes its admin, so don't let the test account take that.
if grep -q '"needsSetup":true' <<<"$config" && [[ -z ${CI:-} ]]; then
  echo "This site has no accounts yet. Create your own admin account in the browser first, then re-run."
  exit 1
fi

EMAIL="smoke-$(date +%s)@example.com"
post /api/auth/register "{\"email\":\"$EMAIL\",\"password\":\"smoke-test-password\",\"displayName\":\"Smoke test\"}" >/dev/null
pass "account created and signed in ($EMAIL)"

slug=$(post /api/catalogues '{"name":"Smoke test","visibility":"private"}' | sed -E 's/.*"slug":"([^"]+)".*/\1/')
[[ -n $slug ]] && pass "catalogue created (/c/$slug)" || fail "catalogue"

if grep -q '"ebirdEnabled":true' <<<"$config"; then
  res=$(post "/api/catalogues/$slug/import/ebird" '{"latitude":51.19,"longitude":-114.47,"radiusKm":10,"areaLabel":"Cochrane"}')
  added=$(sed -E 's/.*"added":([0-9]+).*/\1/' <<<"$res")
  [[ $added -gt 20 ]] && pass "eBird import added $added species around Cochrane" || fail "eBird import: $res"
else
  echo "  skip eBird import (EBIRD_API_KEY not set)"
  post "/api/catalogues/$slug/species" '{"commonName":"American Robin","scientificName":"Turdus migratorius"}' >/dev/null
  pass "species added by hand"
fi

species_id=$(curl -fsS -b "$JAR" "$BASE/api/catalogues/$slug/species" | sed -E 's/^\{"species":\[\{"id":([0-9]+).*/\1/')
sighting_id=$(post "/api/catalogues/$slug/sightings" "{\"speciesId\":$species_id,\"locationName\":\"Smoke test\"}" | sed -E 's/.*"sighting":\{"id":([0-9]+).*/\1/')
pass "sighting logged"

# A real JPEG made by the API container's own image library.
docker compose exec -T api node -e "require('sharp')({create:{width:640,height:480,channels:3,background:'#6f8f6a'}}).jpeg().toBuffer().then(b=>process.stdout.write(b))" >"$IMG"
photo=$(curl -sS -b "$JAR" -F "file=@$IMG;type=image/jpeg" "$BASE/api/sightings/$sighting_id/photos" -w '\n%{http_code}')
[[ ${photo##*$'\n'} == 201 ]] || fail "photo upload: $photo"
photo_id=$(sed -E 's/.*"photo":\{"id":([0-9]+).*/\1/' <<<"${photo%$'\n'*}")
curl -fsS -b "$JAR" -o /dev/null "$BASE/api/photos/$photo_id/thumb" && pass "photo uploaded and thumbnail served" || fail "thumbnail"

[[ $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/catalogues/$slug") == 404 ]] && pass "private catalogue hidden from visitors" || fail "privacy"

echo "All checks passed."
