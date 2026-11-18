#!/usr/bin/env bash
# On the VPS: bring KaamKoRecord up to date with GitHub and restart it.
#   ./scripts/deploy.sh
# KaamKoRecord's nginx (in this compose project) serves kaamkorecord.com with its own certificate.
# The edge nginx in front of both sites (deploy/edge, /opt/edge) is not touched by this script.
# Wrapped in main so the file can safely change during its own git pull.
set -euo pipefail

compose() { docker compose -f docker-compose.prod.yml "$@"; }

# Let's Encrypt limits failed attempts, so this first checks the domain really reaches this site.
ensure_certificate() {
  local domain="$1" email="$2" name
  if compose exec -T nginx test -f "/etc/letsencrypt/live/${domain}/fullchain.pem"; then
    return 0
  fi
  if [ -z "$email" ]; then
    echo "No HTTPS certificate for ${domain} yet. Set ACME_EMAIL in .env and run this again." >&2
    return 1
  fi
  for name in "$domain" "www.${domain}"; do
    if ! curl -fsS --retry 3 --retry-delay 2 --retry-connrefused --max-time 15 -o /dev/null "http://${name}/.well-known/acme-challenge/kkr-check"; then
      echo "Stopped: ${name} does not reach KaamKoRecord's nginx yet. Check its DNS points at this" >&2
      echo "server and the edge nginx is running (cd /opt/edge && docker compose up -d)." >&2
      return 1
    fi
  done
  echo "Getting the HTTPS certificate..."
  compose run --rm --entrypoint certbot certbot certonly \
    --webroot --webroot-path /var/www/certbot \
    --cert-name "$domain" -d "$domain" -d "www.${domain}" \
    --email "$email" --agree-tos --no-eff-email --non-interactive
}

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
  for volume in kaamkorecord_data kaamkorecord_media kaamkorecord_private_media kaamkorecord_static \
                kaamkorecord_letsencrypt kaamkorecord_certbot_www; do
    docker volume create "$volume" >/dev/null
  done
  compose build web

  step="updating the database"
  echo "Updating the database..."
  compose run --rm --no-deps --user root web chown -R app:app /data /app/media /app/private_media /app/staticfiles
  compose run --rm --no-deps web python manage.py migrate --noinput
  compose run --rm --no-deps web python manage.py collectstatic --noinput -v 0

  step="starting the new version"
  echo "Starting the new version..."
  compose up -d --remove-orphans web jobs nginx certbot

  step="setting up HTTPS"
  local domain email
  domain="$(sed -n 's/^KAAMKORECORD_DOMAIN=//p' .env)"
  domain="${domain:-kaamkorecord.com}"
  email="$(sed -n 's/^ACME_EMAIL=//p' .env)"
  ensure_certificate "$domain" "$email"
  # Restarting applies changes to the nginx settings and switches HTTPS on after a first certificate.
  compose restart nginx

  step="checking the live site"
  echo "Checking the live site..."
  curl -fsS --retry 10 --retry-delay 3 --retry-all-errors --max-time 10 -o /dev/null "https://${domain}/"

  step="cleaning up"
  docker image prune -f >/dev/null

  echo "Done. KaamKoRecord is running."
}

main "$@"
