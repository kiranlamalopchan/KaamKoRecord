#!/usr/bin/env bash
# On the VPS: bring KaamKoRecord up to date with GitHub and restart it.
#   ./scripts/deploy.sh
# Bideshkosathi's nginx serves kaamkorecord.com and gets its HTTPS certificate, so deploy
# Bideshkosathi once with KAAMKORECORD_DOMAIN set in its .env.production as well.
# Wrapped in main so the file can safely change during its own git pull.
set -euo pipefail

compose() { docker compose -f docker-compose.prod.yml "$@"; }

main() {
  cd "$(dirname "$0")/.."

  if [ ! -f .env ]; then
    echo "Stopped: .env is missing. Copy deploy/env.example to .env and fill it in." >&2
    exit 1
  fi
  for key in DJANGO_SECRET_KEY DJANGO_ALLOWED_HOSTS; do
    if ! grep -Eq "^${key}=.+" .env; then
      echo "Stopped: ${key} is empty in .env." >&2
      exit 1
    fi
  done

  step="getting the latest code"
  trap 'echo "Deploy stopped while ${step}. Nothing after that step ran. See the messages above." >&2' ERR

  echo "Getting the latest code..."
  git pull --ff-only

  step="building the app"
  echo "Building the app. The site stays up during this..."
  docker network create edge >/dev/null 2>&1 || true
  for volume in kaamkorecord_data kaamkorecord_media kaamkorecord_static; do
    docker volume create "$volume" >/dev/null
  done
  compose build web

  step="updating the database"
  echo "Updating the database..."
  compose run --rm --no-deps --user root web chown -R app:app /data /app/media /app/staticfiles
  compose run --rm --no-deps web python manage.py migrate --noinput
  compose run --rm --no-deps web python manage.py collectstatic --noinput -v 0

  step="starting the new version"
  echo "Starting the new version..."
  compose up -d --remove-orphans web jobs

  step="cleaning up"
  docker image prune -f >/dev/null

  echo "Done. KaamKoRecord is running."
}

main "$@"
