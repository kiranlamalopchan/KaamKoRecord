#!/usr/bin/env bash
# On the VPS: load a copy of the old server's database and uploads into KaamKoRecord.
#   ./scripts/import-data.sh ~/kaamkorecord-data.tgz
# The file holds db.sqlite3 and upload folders, made on the old server with
#   cd ~/MyWork && tar czf ~/kaamkorecord-data.tgz db.sqlite3 media private_media
# This REPLACES the database and uploads here, so run it before people start using this server.
set -euo pipefail

compose() { docker compose -f docker-compose.prod.yml "$@"; }

archive="$(cd "$(dirname "${1:?Give the path to kaamkorecord-data.tgz}")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")/.."

# Not `grep -q`: it stops reading at the first match, tar then dies of SIGPIPE, and with
# pipefail that reads as "not found" for any archive with files after db.sqlite3.
if ! tar tzf "$archive" | grep -x "db.sqlite3" >/dev/null; then
  echo "Stopped: db.sqlite3 is not in ${archive}." >&2
  exit 1
fi

echo "Stopping KaamKoRecord while the data is replaced..."
compose stop web jobs

echo "Copying the database and uploads..."
compose run --rm --no-deps --user root -v "${archive}:/import.tgz:ro" web sh -c '
  set -e
  rm -rf /tmp/import && mkdir /tmp/import && tar xzf /import.tgz -C /tmp/import
  rm -f /data/db.sqlite3 /data/db.sqlite3-wal /data/db.sqlite3-shm /data/db.sqlite3-journal
  cp /tmp/import/db.sqlite3 /data/db.sqlite3
  if [ -d /tmp/import/media ]; then cp -a /tmp/import/media/. /app/media/; fi
  if [ -d /tmp/import/private_media ]; then cp -a /tmp/import/private_media/. /app/private_media/; fi
  chown -R app:app /data /app/media /app/private_media
'
compose run --rm --no-deps web python manage.py migrate --noinput

echo "Starting KaamKoRecord again..."
compose up -d web jobs
echo "Done. The data is loaded."
