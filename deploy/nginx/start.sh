#!/bin/sh
# Starts KaamKoRecord's nginx. It answers kaamkorecord.com only; the edge nginx in front
# (deploy/edge) passes it everything for this domain and nothing else.
# nginx refuses to start when a certificate it names is missing, so HTTPS is only switched on
# once the certificate exists. scripts/deploy.sh gets the first one.
set -eu

: "${KAAMKORECORD_DOMAIN:=kaamkorecord.com}"
export KAAMKORECORD_DOMAIN
conf=/etc/nginx/conf.d/default.conf

envsubst '${KAAMKORECORD_DOMAIN}' < /opt/nginx/kaamkorecord-http.conf.template > "$conf"
if [ -f "/etc/letsencrypt/live/${KAAMKORECORD_DOMAIN}/fullchain.pem" ]; then
  envsubst '${KAAMKORECORD_DOMAIN}' < /opt/nginx/kaamkorecord-https.conf.template >> "$conf"
else
  echo "No certificate for ${KAAMKORECORD_DOMAIN} yet, so serving HTTP only."
fi

nginx -t

# Picks up renewed certificates: the certbot service renews them but can't reload nginx.
(
  while sleep 21600; do
    nginx -s reload
  done
) &

exec nginx -g 'daemon off;'
