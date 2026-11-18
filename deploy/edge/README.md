# The edge nginx

The VPS runs two sites, each with its own nginx:

| Domain | Its nginx | Lives in | Holds |
|---|---|---|---|
| bideshkosathi.com | **Bideshkosathi's nginx** (`bideshkosathi-nginx`) | `/opt/bideshkosathi`, bideshkosathi repo `deploy/nginx/` | its certificate, its settings |
| kaamkorecord.com | **KaamKoRecord's nginx** (`kaamkorecord-nginx`) | `/root/kaamkorecord`, this repo `deploy/nginx/` | its certificate, its settings, chat WebSockets |

Only one program can listen on ports 80 and 443, so in front of both sits the **edge nginx**
(`/opt/edge`, from this folder). It doesn't decrypt anything and holds no certificates: it reads
which domain is being asked for and passes the connection to that site's nginx over the `edge`
Docker network, with the visitor's address. Each site deploys on its own; neither deploy touches
the edge, which only changes when a site is added or removed.

## Moving from the old setup (once)

Before: Bideshkosathi's nginx owned 80/443 and answered both domains. Do these in order on the VPS.
Both repos' changes must be pushed to GitHub first. Steps 1–3 change nothing visitors see; step 4
is the switch (a few seconds); nothing is deleted until step 6.

**1. Give KaamKoRecord its own copy of its certificate** (the original stays where it is):

```bash
docker volume create kaamkorecord_letsencrypt && docker volume create kaamkorecord_certbot_www
docker run --rm -v bideshkosathi_letsencrypt:/from:ro -v kaamkorecord_letsencrypt:/to alpine sh -c '
  mkdir -p /to/live /to/archive /to/renewal &&
  cp -a /from/accounts /to/ &&
  cp -a /from/archive/kaamkorecord.com /to/archive/ &&
  cp -a /from/live/kaamkorecord.com /to/live/ &&
  cp -a /from/renewal/kaamkorecord.com.conf /to/renewal/'
```

**2. Deploy KaamKoRecord** — starts KaamKoRecord's nginx and certbot (no ports yet; the old path
keeps serving the site):

```bash
cd ~/kaamkorecord && ./scripts/deploy.sh
```

**3. Put the edge in place** (not started yet):

```bash
mkdir -p /opt/edge && cp ~/kaamkorecord/deploy/edge/docker-compose.yml ~/kaamkorecord/deploy/edge/nginx.conf /opt/edge/
cd /opt/edge && docker compose config --quiet && docker compose run --rm --no-deps nginx nginx -t
```

**4. Switch.** Bideshkosathi's nginx lets go of 80/443, the edge takes them:

```bash
cd /opt/bideshkosathi && git pull --ff-only \
  && docker compose -f docker-compose.prod.yml --env-file .env.production up -d nginx \
  && cd /opt/edge && docker compose up -d
```

**5. Check:**

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://bideshkosathi.com/healthz/
curl -fsS -o /dev/null -w '%{http_code}\n' https://kaamkorecord.com/
curl -sI http://www.kaamkorecord.com/ | head -1          # 301
echo | openssl s_client -connect kaamkorecord.com:443 -servername kaamkorecord.com 2>/dev/null | openssl x509 -noout -subject -enddate
docker logs --tail 5 kaamkorecord-nginx-1                # real visitor addresses, not 172.x
```

Then open a chat in the app: messages should arrive without waiting (the WebSocket).

**6. Tidy up, a day later**, once both sites have been fine:

```bash
cd /opt/bideshkosathi
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --entrypoint certbot certbot \
  delete --cert-name kaamkorecord.com --non-interactive
sed -i '/^KAAMKORECORD_DOMAIN=/d' .env.production
```

and remove the `kaamkorecord-web` alias from `web` in this repo's `docker-compose.prod.yml`.

## Going back

Until step 6 the old setup is all still there:

```bash
cd /opt/edge && docker compose down
cd /opt/bideshkosathi && git log --oneline -3      # find the commit before the nginx change
git checkout <that commit> -- docker-compose.prod.yml deploy/nginx scripts/deploy.sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d nginx
```

## Adding a third site later

Give it its own nginx on the `edge` network with an alias, listening with `proxy_protocol` on 443
(see either site's `*-https.conf.template`), add its names to both maps in `nginx.conf` here, copy
it to `/opt/edge` and run `docker compose up -d` there.
