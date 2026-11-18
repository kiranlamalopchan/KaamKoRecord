# KaamKoRecord (Django)

KaamKoRecord is the mother project. It hosts two independent apps, and signing in
lands you on a hub where you pick one; from there the navigation belongs
entirely to that app. The same two, and the shared half — board, stories,
alerts, holidays, profiles — are also the native phone app (`mobile/`, over
the API in `apps/api`).

**Search** (`apps.plu`, mounted at `/plu/`; existing URLs and route names are preserved)
- Every signed-in user can upload their own CSV; no staff permission is needed.
- Preview five rows and map any heading to the title, optional description,
  and optional code. Choose the columns that should be searched. All original
  columns are retained on item details, including codes with letters or leading zeroes.
- Multiple private, named catalogues per account, such as Groceries and Meat.
  Each upload creates a separate catalogue by default; the filename suggests its
  name. Choose an existing catalogue explicitly to replace only its items.
  Invalid files or mappings leave existing items intact.
- Use **Search in** to choose the catalogue to search. Each catalogue keeps its
  own heading choices, searchable columns, item count and examples.
- Search words can match across selected columns in any order; exact codes
  and titles lead the results. Counts, samples, item URLs and photo/PDF exports
  are scoped to the signed-in owner, including for staff using the app.
- UTF-8 CSV, comma/semicolon/tab delimiters, up to 10 MB, 20,000 rows and
  50 unique headings. Preview tokens are private, single-use and expire in an hour.
- For butcher data, choose `description` as the title and `plu_no` as the code.
  Numeric PLU catalogues keep picking-list photo matching and PDF export.
  Photo search compares block and automatic OCR layouts, retries faint reads
  with local thresholding, and matches both product titles and descriptions.
  Similar cuts and doubtful OCR stay marked for review; printed quantities
  cannot override a conflicting product name. Under **Change**, search a
  product name or PLU and choose the exact item before exporting the PDF.
- The native app uses `/api/v1/items/search/`, `items/<id>/`, `items/preview/`
  (multipart `file`) and `items/import/` (JSON `upload_id` and mapping).
  Search accepts `catalogue=<id>` and returns the owner's catalogue choices.
  Import accepts an optional `catalogue_id` to replace that owned catalogue;
  omitting it creates a new one. Catalogue names are unique per owner, ignoring case.
  Older `plu/…` API clients default to the owner's first catalogue and can
  select another with `catalogue=<id>`.

After upgrading, run `./scripts/deploy.sh` on the server, then build/update the native app. The old shared PLU list is
preserved **unassigned and hidden**. To explicitly give it to its owner as a
separate **My PLUs** catalogue, run:

```bash
python manage.py claim_legacy_catalogue <username>
```

The command refuses to overwrite an existing My PLUs catalogue. It never assigns the
old list to new accounts automatically. A general example is in
`sample_data/catalogue_sample.csv`.

**TimeSheet Management** (`apps.timeclock`, mounted at `/timesheet/`)
- Clock in and out, with breaks
- Review shifts as a list or a month calendar, and edit them
- Save workplaces and pick which one a shift belongs to — or fill one in
  from a payslip (PDF, photo or screenshot): hourly rate, tax withheld %
  and the pay cycle are read off it
- Set a weekly or fortnightly hours limit and track against it

**Stories** (`apps.stories`, mounted at `/stories/`)
- A row of faces above the notice board: a photo or a short video from
  somebody's day, up for 24 hours, then gone
- Any photo format (HEIC from an iPhone included, via `pillow-heif`), edited
  before it goes: drag and pinch to crop in a 9:16 frame, rotate, flip,
  fit or fill, a few tints — what is sent is the frame as shown, at
  1080×1920
- A video of up to 60 seconds. A longer one isn't turned away: a trimmer
  appears under it — a strip of its frames with a window to drag along,
  or narrow from either end — and only the part chosen is sent: the
  browser cuts the MP4/MOV itself, at the keyframe before the window,
  without re-encoding (`cutVideo` in `app.js` rewrites the sample tables
  over the file's own bytes), and the server makes the exact cut with
  `ffmpeg`, the length checked again there with `ffprobe`. A WebM, or a
  file the browser can't cut, goes whole for the server to cut. Every
  video is re-encoded to H.264 MP4 at up to 1080p (never enlarged) — a 4K
  clip comes down to a fraction of its size, and an iPhone's HEVC plays on
  every phone — so there is no cap on the size of what is sent; what is
  kept is bounded by the re-encoding. Both tools are in the server's
  image (`Dockerfile`); without them a clip every phone plays as it is (H.264 at 1080p
  or under) is kept as it came, anything else is refused, and a trim is
  refused in so many words. The phone grabs a frame for the tile, from the
  start of the part kept
- Tap a face for the full-screen viewer — five seconds a picture, a video
  for as long as it runs, with a speaker to mute; hold to pause, tap either
  side to move, arrows to the next person; react with the board's faces;
  the ring goes quiet once you've looked
- Your own tile shows who has seen it, and takes it down
- Expired stories stop showing at once, and their files are deleted — by
  `manage.py expire_stories` (run it hourly from the **Tasks** tab) and
  quietly whenever the row is built, so a day of videos never fills the disk

**Notifications** (`apps.notifications`, mounted at `/notifications/`)
- An Alerts tab with an unread count and the inbox behind it
- Web Push, so a notification arrives with the app closed
- Raised by the board (new notice, comment, reply, reaction) and by
  TimeSheet (a forgotten clock-out, an hours cap coming up)

Adding a third app means starting it inside `apps/`, mounting it under its
own prefix in `mywork/urls.py`, and giving it an entry in
`mywork/context_processors.py` plus a card on the hub. To have it notify
people, give it a `notify.py` and call `apps.notifications.notify.notify()` —
see [Notifications](#notifications).

## The native app and its API

New roster, reminders, messaging, payslip checks, pay-period summaries, widgets
and Nepali settings are described in [Work features and phone testing](docs/work-features.md).

`mobile/` is the Android/iOS app (Expo — see `mobile/README.md`). It talks
to `apps/api`, a Django REST Framework layer at `/api/v1/` that wraps the
same models, forms and notify calls the pages use: a token from
`auth/login/` in an `Authorization: Token …` header, the phone's zone in
`X-Timezone`; `auth/logout/` drops the token unless the app sends
`keep_token` — it has put it behind the phone's Face ID or fingerprint to
sign in with next time. Pushes to the app go through Expo's push service
(`Device` rows in `apps.notifications`, beside the browsers' `PushSubscription`
rows). TimeSheet is `timesheet/…` there: the clock and its three actions,
the timesheet and calendar, shifts (with the same `ShiftForm` and break
rows), workplaces (with the payslip reader), pay, and the statement PDF —
`apps/api/views/timeclock.py` calls the page views' own helpers so the
app's figures are the site's. PLU's photo search is `plu/photo/`
(the read as rows, the phone keeps them) and `plu/photo/pdf/` (the rows
back, as the picking-list PDF). After updating, run `./scripts/deploy.sh` on the
server — a store-style build of the app is pointed at the
live site and can't sign in until that has happened (the phone can be
pointed elsewhere from the sign-in screen meanwhile).

## Deploying (Hostinger VPS)

KaamKoRecord runs at https://kaamkorecord.com on the same VPS as Bideshkosathi, in its own
containers with its own database and uploads (`docker-compose.prod.yml`). **KaamKoRecord's nginx**
(`deploy/nginx/`, the `nginx` service) answers `kaamkorecord.com`: it holds the HTTPS certificate
(renewed by the `certbot` service), serves `/static/` and the public upload folders (`avatars`,
`stories`, `festivals`), forwards chat WebSockets on `/ws/`, and passes the rest to this app.
In front of both sites is the **edge nginx** (`deploy/edge/`, at `/opt/edge` on the VPS), the one
thing on ports 80/443, which sends each domain to its own site's nginx. Bideshkosathi has its own
nginx. See `deploy/edge/README.md`, including the one-time move from the old shared setup.
A `jobs` container runs the scheduled work (`scripts/jobs.sh`).

First time, on the VPS:

```bash
git clone https://github.com/kiranlamalopchan/KaamKoRecord.git ~/kaamkorecord
cd ~/kaamkorecord
cp deploy/env.example .env     # fill it in; keep the old secret key and VAPID keys
./scripts/deploy.sh
```

With the edge nginx running and the domain's DNS pointing at the VPS, `deploy.sh` gets the first
certificate itself (set `ACME_EMAIL` in `.env`).

Every update after that: `./scripts/deploy.sh` here. It pulls, builds, migrates, collects static
files and restarts. Chat WebSockets run through Daphne and Redis in the same Compose project.
KaamKoRecord's nginx forwards the `Upgrade` and `Connection` headers on `/ws/`; without them the
app quietly falls back to polling. Private message photos live in the
`kaamkorecord_private_media` volume and are only returned through signed participant-only routes.

No extra environment variable is required for realtime locally or in this Compose deployment:
Compose supplies `REDIS_URL=redis://redis:6379/0` to the web container. A different deployment may
set `REDIS_URL` to its own private Redis service.

To load a copy of another server's data (this replaces what is here):

```bash
./scripts/import-data.sh ~/kaamkorecord-data.tgz   # holds db.sqlite3, media/ and private_media/
```

A new secret key:

```bash
python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"
```

`mywork.settings.local` runs with `DEBUG = True`, which shows a full traceback and your settings to
anybody who triggers an error. It is for a laptop, not for a site with an address.

## Chat

The app's Chats tab: direct conversations between friends and groups, by stable conversation id.
Rules live in `apps/chat/services.py`, media handling in `apps/chat/media.py`, the API in
`apps/api/views/conversations.py` (the older username endpoints in `chat.py` stay for app versions
already in the stores). Realtime is the WebSocket at `/ws/chat/` (Daphne + Redis, above); without it
the app falls back to polling.

**Who may talk:** a direct conversation needs an accepted friendship and no block either way.
A group is created from the creator's friends; members are then members until they leave or an
admin removes them. Somebody blocked by a member stops that member sending in the group.
**Group history:** the people a group starts with see all of it; anybody added later sees only
what is said from the moment they were added (`ConversationMember.history_from`).

**Attachments** (all re-made on the server, kept in `private_media/`, never under `/media/`):
photos (JPEG/PNG/WebP/HEIC; up to 10 at once; Standard 1600 px q75 or HD 2560 px q88; a 320 px
thumbnail; EXIF and GPS dropped; transparency kept as WebP), video (H.264/AAC MP4, 720p Standard or
1080p HD, at most 30 fps, poster frame; refused — never cut — over 5 minutes), voice messages
(mono AAC 32 kbps, up to 10 minutes) and documents (PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP,
checked against their file signatures, always served as downloads). Video and voice need `ffmpeg`
and `ffprobe` (in the Docker image). Large videos and files go up in resumable pieces through
`/api/v1/uploads/`. Files are served only through links signed for one viewer that expire after an
hour, and every request checks again that the viewer is still in the conversation.

Limits can be changed without code with `CHAT_MEDIA` in settings, e.g.
`CHAT_MEDIA = {"video_max_seconds": 120, "file_max_bytes": 50 * 1024 * 1024}`
(keys: see `DEFAULTS` in `apps/chat/media.py`). Sending is limited to 40 messages a minute a person.

**Privacy, as it actually is:** messages travel over HTTPS/WSS and are stored on this server,
readable only through the conversation's members' accounts. They are **not** end-to-end encrypted,
and the app says so on the chat details screen. Reporting a message sends only that message's words
to the moderators (`moderation.Report`, kind `message`); nobody gets an admin view of conversations.

**Not built yet (needs outside setup):** voice and video calls (WebRTC with `react-native-webrtc`,
a TURN server such as coturn with credentials in the environment, and CallKit/ConnectionService
for ringing a locked phone), end-to-end encryption (a maintained protocol such as Signal's, with
multi-device keys — not to be invented here), object storage/CDN for media (files are on the VPS
volume `kaamkorecord_private_media`; back it up with the database), and per-person chat colours.

**Rollback:** the chat migrations only add. To go back, deploy the previous code and leave the
schema as it is — older code ignores the new tables and columns and doesn't list group messages.
Only unapply `chat 0005` on a database with no group messages (`recipient` becomes required again).

## Notifications

The Alerts tab, the inbox and the count on them are plain Django and need no setup:
every event is recorded whether or not anything can be delivered. What needs
setting up is the *push* half — the part that reaches a phone with the app
closed.

The native app resolves notification `/notifications/<id>/go/` links through
the authenticated API, marks them read, and opens the matching app screen.
It waits for sign-in and navigation on a cold start and consumes each tap once.
Unavailable or unsupported destinations open the app's inbox. Web Push links
continue to open the website. Updating this behavior requires updating the
mobile app's JavaScript bundle or installing a new build.

### Keys

Web Push identifies this site to every browser's push service with a keypair
(VAPID). Generate one, once:

```bash
python manage.py vapid_keys
```

and put the three lines it prints in the server's `.env` (see `deploy/env.example`):

```
VAPID_PRIVATE_KEY=...
VAPID_PUBLIC_KEY=...
VAPID_CONTACT_EMAIL=you@example.com
```

Then run `./scripts/deploy.sh`. With no keys set, KaamKoRecord runs exactly as before
and simply never interrupts anyone — the inbox says so rather than offering a
switch that cannot work.

The pair is not rotated casually: a browser subscribes to a specific public
key, so replacing it invalidates every subscription already granted and
everybody has to turn notifications back on.

### Turning it on, as a user

Open Alerts, then **Turn on**, and accept the browser's prompt. The prompt
has to come from that tap — asking on page load is how a browser learns to
refuse on your behalf permanently.

**On an iPhone this only works from the Home Screen.** Safari in a tab cannot
subscribe at all; iOS 16.4 or newer, opened from an icon added with *Share ->
Add to Home Screen*, can. The inbox says this instead of showing a dead
button.

### Reminders

The two TimeSheet reminders are the only things not raised by the request that
caused them — nothing happening is the thing worth saying — so they need
something periodic to notice. **This needs no setup: it already runs.**

`ReminderSweepMiddleware` runs them off the back of ordinary page loads. Every
request asks one indexed question — "has this run in the last fifteen
minutes?" — and the rare one that finds it has not runs the sweep. The claim
is a single conditional UPDATE, so several workers answering requests at the
same moment cannot both start it.

The `jobs` container also runs `timesheet_reminders` every 15 minutes, so reminders go out even
when nobody is using the site. Running it by hand is harmless: every reminder is keyed to the shift
or the pay period it is about, so a second run rewrites the line it already sent rather than sending
another one, and a phone is only buzzed again about the same forgotten clock-out after three hours.

### If nothing arrives

In order of how often it is the answer:

1. **No keys, or the site was not redeployed** after adding them.
2. **The iPhone is in Safari rather than on the Home Screen** — see above.
3. **The subscription is stale.** Django Admin -> Push subscriptions shows
   whether that person has a row at all. Opening any page re-registers it, so
   "load the site once, then try again" resolves most of these.
4. **They are using Firefox.** See below.

## Layout

```
mywork/              the project: settings, root URLs, hub views
  settings/
    base.py          everything true in every environment
    local.py         a laptop — the default in manage.py
    production.py    a server — secrets and hosts come from the environment
apps/                the four applications written for this project
  accounts/          who you are: profile, avatar, contact details
  plu/               PLU lookup
  timeclock/         clocking, timesheets, pay
  noticeboard/       the board both apps share
  notifications/     the bell: one mailbox, and Web Push to carry it
templates/           every template, one directory, base.html at its root
static/              css, js, icons, the web manifest
```

Two things about `apps/` are worth knowing before changing anything in it.
Each app's `name` is its import path (`apps.timeclock`) while its `label` is
what the database knows it by (`timeclock`) — the label is set explicitly in
every `apps.py` because migrations already applied are recorded against it and
string references like `"accounts.Profile"` resolve through it. And templates
are addressed by the path under `templates/`, not by the app's module path, so
`timeclock/shifts.html` did not move when `timeclock` did.

The front end is built to feel like a phone app rather than a web page, and
the whole of it is one stylesheet, `static/css/app.css`, laid out phone-first
with a few `min-width` queries for tablets and desktops. The pieces of chrome
worth knowing: the **app bar** behaves like a navigation bar — a page's
`.backlink` is lifted into its left corner on phones and the page's `h1`
appears in its middle once it has scrolled away; the **dock** at the foot of
a phone is one bar for the whole app — Home, Search, Work, Alerts, Profile,
with unread badges on Alerts — and its solid green pill is a
knob that slides between the tabs (tapping the tab you are on scrolls to the
top). Photo search and Upload catalogue are page actions rather than destination tabs; the **segmented controls** (`.segments`: Search / Catalogues in Search; Clock /
Timesheets / Pay / Settings in Work; and List / Calendar on the timesheet) are the same track-and-knob; and every yes-or-no is a **switch**
(`.switch` — the markup is in `timeclock/_form_fields.html`) modelled on the
day-and-night switch in the app bar. Pages come in the way screens do — a
push from the right, a pop back to the left, a cross-fade between tabs —
from a `data-arrive` attribute `app.js` writes on `<body>`. A new component
must be able to shrink: grids use `minmax(0, 1fr)`, flex and grid items get
`min-width: 0`, and nothing is allowed to widen a 320px screen (§23 of the
stylesheet lists the rules).

Home keeps stories, holidays, daily extras and the notice board; main tools
are reached through navigation. Android and iOS use Expo's native tabs and
native stacks, including Alerts with its unread badge. Profile settings owns
appearance and sign out. Website navigation data lives in the shared context
processor, `_nav_link.html` renders each entry, and `static/js/theme.js` owns
saved/system appearance and browser chrome across every page.

Clock shows a realistic analog face with moving hour, minute and second hands,
with worked or break duration underneath. Hours restrictions remain on Clock
and under Work → Settings → Workplaces. The mobile app groups the same tools
inside its Work tab; the old `/clock`, `/timesheet`, `/pay` and `/more` routes
redirect to their new screens, including calendar links. CSV imports include
File, Headings and Review steps, and each owner's named catalogues stay private.

Every page is rendered by Django, but tapping
a link does not reload the site: `static/js/app.js` fetches the next page —
starting the moment a finger lands on the link — and swaps its `<body>` in
place, so the stylesheet and scripts are parsed once per visit rather than
once per tap. Forms, downloads, other origins, modified clicks and anything
that isn't an HTML page are left to the browser, and a page whose CSS or JS
hashes differ from the document's (a deploy landed) gets a real load. Two
attributes opt a link out: `data-full-load` (always a real navigation) and
`data-no-cache` (never prefetched or reused — for a page whose GET does
something, like the inbox marking itself read). Anything that sets a page up
belongs in `initPage()`, which runs for every page; anything wired to
`window` or `document` there goes through `listen()` / `every()` so it is
undone when the page is left. See the comments at the top and bottom of
`app.js`.

Shared rendering lives in `templates/_form_field.html`,
`templates/registration/base.html` and the `ui` icon tags. Website views and the
API share redirect validation (`mywork/http.py`), timestamp formatting
(`mywork/formatting.py`), moderation targets, thread folding and fortnight hints.
Validation screenshots are in `design/shared-components/`.

## Settings

`DJANGO_SETTINGS_MODULE` chooses; nothing imports one settings module from
another except `local` and `production` importing `base`.

```bash
python manage.py runserver                      # mywork.settings.local, the default

DJANGO_SETTINGS_MODULE=mywork.settings.production \
DJANGO_SECRET_KEY=... DJANGO_ALLOWED_HOSTS=example.com \
  python manage.py check --deploy
```

`production` reads `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS` from the
environment and raises on start-up if either is missing, rather than falling
back to something that would appear to work. Set `POSTGRES_DB` (with
`POSTGRES_PASSWORD`, and `POSTGRES_USER`/`HOST`/`PORT` if they are not the
defaults) to move off SQLite.

## 1) Setup (Mac / Windows)

```bash
python -m venv .venv
source .venv/bin/activate   # Mac/Linux
# .venv\Scripts\activate  # Windows

pip install -r requirements.txt
```

## 2) Run migrations + create admin user

```bash
python manage.py migrate
python manage.py createsuperuser
```

## 3) Start the server

```bash
python manage.py runserver
```

Open:
- http://127.0.0.1:8000/  (hub — pick an app)
- http://127.0.0.1:8000/plu/  (PLU search)
- http://127.0.0.1:8000/plu/photo-search/  (photo search)
- http://127.0.0.1:8000/plu/import/  (CSV import, staff only)
- http://127.0.0.1:8000/timesheet/  (clock in / out)
- http://127.0.0.1:8000/timesheet/shifts/  (timesheet)
- http://127.0.0.1:8000/admin/  (admin)

### Using it on your phone

Start the server so it listens on the network, not just localhost:

```bash
python manage.py runserver 0.0.0.0:8000
```

Then on a phone on the same Wi-Fi, open `http://<your-computer-ip>:8000/`
(`ipconfig getifaddr en0` on a Mac prints the IP). In Safari or Chrome use
**Share -> Add to Home Screen** to get an app icon that opens full screen.

## 4) CSV format

The first row contains your own unique headings. On **Search → Upload catalogue**, name
the catalogue (for example Groceries or Meat), preview and choose which headings
provide the title, description and code, then select
the searchable columns. No fixed header names are required. A title column is
required; descriptions and codes are optional. Nonempty codes must be unique
within the file. Rows with a blank title are skipped and counted; a file with
no usable titles cannot replace an existing catalogue. New uploads keep previous
catalogues; use **Save to → Replace …** to replace a chosen catalogue. On the
search screen, choose **Search in** to search that catalogue's items.

```csv
Code,Title,Description,Category
001,Blue apron,Wash cold,Clothing
A-9,Steel knife,Stainless steel,Tools
```

For PLU data, `plu_no,description` still works: map `description` to title and
`plu_no` to code. Sample butcher files remain in `sample_data/plu_sample.csv`
and `sample_data/plu_items.csv`, and the general example is
`sample_data/catalogue_sample.csv`.

The SQLite database is not committed. After a fresh clone, run migrations and
upload your CSV from your own account to create a private catalogue.


## Festival banner (Home only)

Administrators choose one shared festival under **Admin → Public holidays →
Home festival banner**. An administrator with change permission also gets a
**Manage festival banner** link on their profile. Ordinary users have no theme
selector, and previous device preferences are ignored. The saved choice applies
to everyone. Light/dark appearance remains an individual setting.

The banner appears only at the top of Home. It contains a landscape illustration,
a festival greeting and a short explanation. The original application palette
and all other cards/pages stay unchanged. Every festival in the admin selector has its own illustration and live motion.
Dashain has flying kites and a swinging seat, Tihar has glowing diyas, Christmas
has falling snow, New Year has fireworks, Eid has a swaying lantern, and the
remaining festivals have matching flags, petals, colour, bells or reflections.
Reduced-motion preferences show a still illustration, and movement pauses
while the banner is off-screen or the browser tab is hidden.

Choose a festival manually, **Off** to hide the banner, or **Automatic** to
follow festival dates using the site's `TIME_ZONE` for every user. Administrators
can optionally replace the greeting and explanation for a manual selection.
Automatic uses standard descriptions to avoid carrying one festival's copy into
another. The calendar uses the `holidays` package and is independent of payroll
and the Australian public-holiday records. Calendar dates can be revised; keep
the dependency current. Exact-date overrides can be supplied in Django settings
as `SEASONAL_THEME_DATES = {"YYYY-MM-DD": {"id": "dashain"}}`.

After updating, run `./scripts/deploy.sh` on the server. The migration creates the single shared banner
settings row with Automatic selected. Admin changes are reflected on the next
Home page load.
