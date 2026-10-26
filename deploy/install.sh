#!/usr/bin/env bash
# Featherkeeper installer for Debian and Ubuntu (an LXC, a VM or a spare machine).
#
#   curl -fsSL https://github.com/tposella/featherkeeper/releases/latest/download/install.sh | sudo bash
#
# What it does: installs Docker if it's missing, downloads the release's docker-compose.yml and
# example settings into /opt/featherkeeper, writes a .env with a random database password, pulls the
# ready-made images and starts them. Running it again updates the compose file and images and keeps
# your .env, photos and database.
#
# Options (as flags, or the environment variables in brackets):
#   --dir DIR            where to install (FEATHERKEEPER_DIR, default /opt/featherkeeper)
#   --port PORT          web port on this machine (FEATHERKEEPER_PORT, default 8080)
#   --url URL            the address people will use, e.g. https://birds.example.com (PUBLIC_URL)
#   --ebird-key KEY      your eBird API key, optional (EBIRD_API_KEY)
#   --version X.Y.Z      a release to install instead of the latest (FEATHERKEEPER_VERSION)
#   --ai                 also run the AI identifier (needs about 3 GB of RAM)
#   --no-docker-install  don't install Docker (it must already be there)
#   --from DIR           use docker-compose.yml and .env.example from a checkout instead of downloading
#   --yes                don't ask before starting
set -euo pipefail

REPO="${FEATHERKEEPER_REPO:-tposella/featherkeeper}"
DIR="${FEATHERKEEPER_DIR:-/opt/featherkeeper}"
PORT="${FEATHERKEEPER_PORT:-8080}"
URL="${PUBLIC_URL:-}"
EBIRD="${EBIRD_API_KEY:-}"
VERSION="${FEATHERKEEPER_VERSION:-}"
AI=false
INSTALL_DOCKER=true
FROM=""
YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --ebird-key) EBIRD="$2"; shift 2 ;;
    --version) VERSION="${2#v}"; shift 2 ;;
    --ai) AI=true; shift ;;
    --no-docker-install) INSTALL_DOCKER=false; shift ;;
    --from) FROM="$2"; shift 2 ;;
    -y|--yes) YES=true; shift ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this as root (or with sudo)."
[[ $PORT =~ ^[0-9]+$ ]] || die "--port must be a number."

# ---- Docker -----------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  $INSTALL_DOCKER || die "Docker with the compose plugin isn't installed (and --no-docker-install was given)."
  say "Installing Docker (from get.docker.com)"
  command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null; }
  curl -fsSL https://get.docker.com | sh >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker compose version >/dev/null 2>&1 || die "Docker's compose plugin isn't working."

# ---- Files ------------------------------------------------------------------------------
mkdir -p "$DIR"
cd "$DIR"
# An install pinned to a version (FEATHERKEEPER_TAG=0.2.1 in .env) stays on it unless --version says otherwise.
if [[ -z $VERSION && -f .env ]]; then
  PINNED=$(grep -E '^FEATHERKEEPER_TAG=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')
  if [[ -n $PINNED && $PINNED != latest ]]; then
    VERSION="${PINNED#v}"
    say "This install is pinned to $VERSION (FEATHERKEEPER_TAG in .env). Use --version X.Y.Z to change it."
  fi
fi
if [[ -n $VERSION ]]; then
  BASE="https://github.com/$REPO/releases/download/v$VERSION"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

fetch() { # fetch <asset> <destination>
  if [[ -n $FROM ]]; then
    case "$1" in
      docker-compose.yml) sed '/^[[:space:]]*build:/d' "$FROM/docker-compose.yml" >"$2" ;;
      example.env) cp "$FROM/.env.example" "$2" ;;
      backup.sh) cp "$FROM/deploy/backup.sh" "$2" ;;
    esac
  else
    curl -fsSL "$BASE/$1" -o "$2" || die "Couldn't download $1 from $BASE"
  fi
}

[[ -f docker-compose.yml ]] && cp docker-compose.yml docker-compose.yml.previous
say "Getting docker-compose.yml${VERSION:+ for $VERSION}"
fetch docker-compose.yml docker-compose.yml
fetch backup.sh backup.sh
chmod +x backup.sh

# ---- Settings (.env) --------------------------------------------------------------------
set_env() { # set_env KEY VALUE: replace "KEY=..." (or a commented "# KEY=...") or add it
  local key="$1" value="$2"
  if grep -qE "^#? ?$key=" .env; then
    local escaped
    escaped=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')
    sed -i -E "s|^#? ?$key=.*|$key=$escaped|" .env
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

if [[ -f .env ]]; then
  say "Keeping your existing .env"
  [[ -n $VERSION ]] && set_env FEATHERKEEPER_TAG "$VERSION"
else
  say "Writing .env"
  fetch example.env .env
  chmod 600 .env
  if [[ -z $URL ]]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    URL="http://${IP:-localhost}:$PORT"
  fi
  set_env PUBLIC_URL "$URL"
  set_env WEB_PORT "$PORT"
  set_env POSTGRES_PASSWORD "$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"
  set_env FEATHERKEEPER_TAG "${VERSION:-latest}"
  [[ -n $EBIRD ]] && set_env EBIRD_API_KEY "$EBIRD"
  if $AI; then
    set_env COMPOSE_PROFILES ai
    set_env IDENTIFY_PROVIDER bioclip
  fi
fi

if ! $YES && [[ -t 0 ]]; then
  echo
  echo "Ready to start Featherkeeper in $DIR on port $PORT."
  read -r -p "Start it now? [Y/n] " answer
  [[ ${answer:-Y} =~ ^[Yy] ]] || { echo "Stopped. Start it later with: cd $DIR && docker compose up -d"; exit 0; }
fi

# ---- Start ------------------------------------------------------------------------------
say "Downloading the images (the first time takes a few minutes)"
docker compose pull --quiet
say "Starting Featherkeeper"
docker compose up -d --wait --wait-timeout 300 || {
  warn "It didn't become healthy in time. See: cd $DIR && docker compose logs"
  exit 1
}

URL_NOW=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2-)
echo
say "Featherkeeper is running: $URL_NOW"
cat <<EOF

  Next:
  1. Open $URL_NOW and create your account. The first account becomes the site admin,
     so do this before anyone else can reach the site.
  2. Add your eBird API key to $DIR/.env (EBIRD_API_KEY, free at https://ebird.org/api/keygen)
     if you haven't, then run: cd $DIR && docker compose up -d
  3. Nightly backups: add to crontab -e
     15 3 * * * cd $DIR && ./backup.sh /path/to/backups >> /var/log/featherkeeper-backup.log 2>&1

  Update later with: cd $DIR && docker compose pull && docker compose up -d
  Docs: https://tposella.github.io/featherkeeper/docs/

EOF
