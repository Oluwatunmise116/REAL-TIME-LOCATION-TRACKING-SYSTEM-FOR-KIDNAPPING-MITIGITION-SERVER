# Axiometer Dashboard

Live location, liveness, motion alerts and SOS alarms for Axiometer personal-safety trackers
(ESP32-C6 + SIMCom A7670E LTE/GNSS + MPU6050 IMU + SOS button).

Devices publish to an MQTT broker (HiveMQ Cloud, TLS). A server-side bridge subscribes, validates and
stores every message in SQLite, derives each device's status, and streams updates to browsers over
Server-Sent Events. The browser never sees broker credentials.

```
 tracker ──MQTT/TLS──▶ HiveMQ Cloud ──▶ MQTT bridge (Node, started from instrumentation.ts)
                                          │  zod validation → SQLite (Drizzle) → derived status (1 s tick)
                                          ▼
                                   in-process EventEmitter
                                          │
                     GET /api/stream (SSE: snapshot + incremental) ──▶ browser (zustand store)
                     REST /api/devices, /api/events, … ─────────────▶ Google Maps, timeline, alerts
```

> **Not for Vercel / serverless.** The bridge keeps one MQTT connection open for the life of the
> process and fans messages out to open SSE streams. Serverless functions are frozen between requests,
> so neither works there. Deploy to a long-running Node host: Docker, Railway, Render, Fly.io or a VPS.

---

## Quick start (no hardware, no cloud)

Requires Node 22+ (developed on Node 24).

```bash
npm install
cp .env.example .env
#  edit .env: MQTT_URL=mqtt://localhost:1883, DASHBOARD_PASSWORD=…, SESSION_SECRET=<32+ chars>

npm run broker            # terminal 1: local MQTT broker on :1883 (pure Node, no Docker needed)
npm run dev               # terminal 2: dashboard on http://localhost:3000
npm run simulate -- --url mqtt://localhost:1883 --motion --sos     # terminal 3
```

Prefer Mosquitto? `docker compose up mosquitto` gives the same broker on :1883.

Sign in with `DASHBOARD_PASSWORD`. The simulated device appears within a second, gets a GPS fix after
30 s (cold start), walks from Yaba towards Ikeja, raises a motion alert and then an SOS.

Without a Google Maps key everything works except the map itself, which shows an inline “API key
missing” card (coordinates, “Open in Google Maps” links and alerts still work).

---

## Environment

| Variable | Required | Description |
|---|---|---|
| `MQTT_URL` | yes | `mqtts://<cluster>.s1.eu.hivemq.cloud:8883`, or `mqtt://localhost:1883` locally |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | for HiveMQ | A **subscribe-only** credential (see below) |
| `MQTT_TOPIC_ROOT` | no | Topic root, default `devices` (subscribes to `<root>/+/#`) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | for the map | Browser key, restricted by HTTP referrer |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | recommended | Map ID for Advanced Markers + cloud styling. Falls back to `DEMO_MAP_ID` (default Google styling) |
| `DEFAULT_MAP_CENTER` | no | `lat,lon` used when no device has a fix. Default Lagos `6.5244,3.3792` |
| `DASHBOARD_PASSWORD` | yes | The admin password |
| `SESSION_SECRET` | yes | ≥ 32 random characters, e.g. `openssl rand -base64 48` |
| `DATABASE_PATH` | no | Default `./data/axiometer.db` (directory is created automatically) |
| `RETENTION_DAYS` | no | Default 30. Positions, raw messages, heartbeat summaries and status/reboot events older than this are purged hourly. **SOS and motion events are never deleted automatically.** |
| `SIM_MQTT_USERNAME` / `SIM_MQTT_PASSWORD` | no | Simulator only: a credential allowed to *publish* (the dashboard's must not be) |

All of these are read **at runtime** (the Maps key is served to the signed-in browser by `/api/config`),
so a single build or Docker image works in any environment. Moving to another broker — e.g. when HiveMQ
Cloud Serverless is retired on 31 Dec 2026 — is only an `MQTT_URL` / credential change.

---

## HiveMQ Cloud: subscribe-only credential

The dashboard only needs to read. Give it its own credential so a leaked dashboard secret can't
publish fake alerts or Last Wills.

1. HiveMQ Cloud console → your cluster → **Access Management** → **Credentials** → *Add credentials*.
2. Username `dashboard-reader`, a long random password.
3. Permissions: create (or assign) a permission with **topic filter `devices/#`** and **type: Subscribe**
   only (no Publish). On plans with role-based permissions, create a role `dashboard-subscribe` with that
   permission and attach it to the credential.
4. Put the values in `MQTT_USERNAME` / `MQTT_PASSWORD`; set `MQTT_URL` to the cluster URL from
   **Overview** (`mqtts://…:8883`).

The bridge connects with `clean: true`, a unique client id per process (`axiometer-dash-<random>`),
auto-reconnect with exponential backoff (2 s → 60 s), and subscribes to `devices/+/#` at QoS 1.

---

## Google Maps

1. Google Cloud Console → create/select a project → **APIs & Services → Library** → enable
   **Maps JavaScript API** and **Geocoding API**.
2. **APIs & Services → Credentials → Create credentials → API key.** Edit the key:
   - *Application restrictions* → **Websites** → add your origins, e.g. `https://dash.example.com/*`
     and `http://localhost:3000/*` for development.
   - *API restrictions* → **Restrict key** → select Maps JavaScript API and Geocoding API.
   Put it in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
3. **Map ID** (needed for Advanced Markers and cloud styling): Google Maps Platform →
   **Map management → Create Map ID** → type *JavaScript*, *Vector*. Put it in `NEXT_PUBLIC_GOOGLE_MAP_ID`.
4. **Styles** (Google Maps Platform → **Map styles**): create two styles and associate both with the Map ID —
   one as the **light** style, one as the **dark** style (the map switches with the dashboard theme via
   `colorScheme`). Suggested settings, so markers pop:
   - **Light**: background/landscape `#F3F4F6`; roads `#FFFFFF` with `#E5E7EB` strokes, arterials/highways
     `#E5E7EB`; parks `#DCEFE0`; water `#D6E4EF`; POI icons off except parks/transit; label text `#6B7280`
     with white halo; administrative boundaries light grey.
   - **Dark**: landscape `#111827`; roads `#1F2937` (highways `#273244`); parks `#13261B`; water `#0B1A2A`;
     label text `#9CA3AF` with `#0B0F14` halo; POI icons off.

   You can start from the built-in *Silver* (light) and *Night* (dark) templates and desaturate.
5. Reverse geocoding for the info card uses the Geocoding library in the browser; results are cached
   by coordinates rounded to 4 decimals and failures show “Address lookup unavailable”.

---

## Device simulator

`npm run simulate` publishes exactly the firmware contract (retained `online` + Last Will `offline`,
heartbeat every 2 s, telemetry every 10 s with a 30 s cold start of `null` positions, motion and SOS).

```bash
npm run simulate                                         # broker from .env
npm run simulate -- --url mqtt://localhost:1883 --id sim-002
npm run simulate -- --count 3 --motion --sos             # three devices, staggered on the route
```

| Flag | Effect (default time after start) |
|---|---|
| `--id <id>` / `--count <n>` | device id (default `sim-001`) / simulate n devices |
| `--motion` | CANDIDATE → SUSPICIOUS (`SUSPECTED_DISTRESS`) → NORMAL (40 s, `--motion-at`) |
| `--sos` | 9 × SOS SUSPICIOUS, then DANGER on the 10th press, plus one duplicate retry (50 s, `--sos-at`) |
| `--reboot` | reset seq/up and lose the GPS fix (90 s, `--reboot-at`) |
| `--drop` | stop heartbeats for 15 s → “Signal lost” (25 s, `--drop-at`) |
| `--null-ts` | send `"ts": null` (unsynced clock → “approx.” in the UI) |
| `--no-fix` / `--fix-after <s>` | never get a fix / first fix after s seconds (30) |
| `--duration <s>` | exit after s seconds (publishes retained `offline`) |
| `--kill` | on exit, drop the socket so the broker fires the Last Will |

---

## Deployment

### Docker

```bash
docker build -t axiometer-dashboard .
docker run -d --name axiometer -p 3000:3000 --env-file .env \
  -v axiometer-data:/app/data axiometer-dashboard
```

The image uses Next's standalone output, runs as a non-root user, stores SQLite in the `/app/data`
volume and applies migrations on start. `docker compose --profile app up --build` runs it next to a
local Mosquitto.

### Railway / Render / Fly.io

Deploy the Dockerfile as a web service, set the environment variables, and **attach a persistent volume
mounted at `/app/data`** (Railway: Volumes; Render: Disks; Fly: `fly volumes create` + `[mounts]`).
Run exactly **one instance**: the bridge and SSE fan-out are in-process.

### VPS (no Docker)

```bash
npm ci && npm run build
PORT=3000 npm start          # run under systemd/pm2 with the env from .env
```

Behind nginx, disable buffering for the event stream:

```nginx
location /api/stream {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_read_timeout 1h;
}
```

Serve over HTTPS: the session cookie is marked `Secure` when the request (or `X-Forwarded-Proto`) is https.

---

## Topic contract (from the firmware — do not change)

Topics are `devices/<deviceId>/<channel>`. Device ids are discovered automatically.

| Channel | Payload | Cadence | QoS / retain |
|---|---|---|---|
| `status` | plain text `online` / `offline` (**not JSON**) | `online` on connect; `offline` is the broker's Last Will | QoS 1, retained |
| `heartbeat` | `{"seq":690,"up":1411}` | every 2 s | QoS 0 |
| `telemetry` | `{"ts":"2026-10-30T01:44:26Z","lat":6.524412,"lon":3.379201}` | every 10 s | QoS 1 |
| `motion` | `{"state":"SUSPICIOUS","prev":"CANDIDATE","indicator":"SUSPECTED_DISTRESS","ts":"…","lat":null,"lon":null,"age":-1}` | on state change | QoS 1 |
| `sos` | `{"level":"DANGER","presses":10,"seq":12,"ts":"…","lat":6.52,"lon":3.37,"age":4}` | on button activation (hold ≥ 1 s) | QoS 1 |

How the dashboard interprets it:

- **`lat`/`lon` null = no fix has ever been accepted.** Never coerced to 0, never drawn at (0,0); the map
  shows “Waiting for first GPS fix”. A literal (0,0) or half-null pair is also treated as no position.
- Telemetry positions are the *last known* position (no age). Alerts carry `age` = seconds since the fix
  was accepted; `-1` = no position.
- `ts` is the event time. Everything is ordered by `ts`; queued alerts that arrive late slot into place.
  `ts: null` → server receive time, shown as “approx.”.
- Heartbeat `seq`/`up` going down = **Device restarted** event; so does an uptime too small for the
  wall-clock time that passed while unobserved. Gaps in `seq` are dropped QoS 0 heartbeats.
- Motion states `INITIALIZING`, `CALIBRATING`, `NORMAL`, `CANDIDATE` (transient, hidden by default in the
  timeline), `SUSPICIOUS`; indicators `UNUSUAL_MOTION`, `IMPACT_THEN_INACTIVITY`, `SUSPECTED_DISTRESS`.
  Unknown values render as-is. Wording follows the firmware authors: *unusual motion patterns*, never
  “kidnapping detected”. SOS is the only human-intent signal.
- SOS `SUSPICIOUS` (≥ 1 activation) / `DANGER` (10 within 2 min); retries are deduplicated on
  `(deviceId, seq, ts)`. Presses within 2 minutes of each other form one incident (one map pin, one
  acknowledge).

### Derived status (server-side, every second)

| State | Rule |
|---|---|
| Online | retained status `online` and a heartbeat in the last 8 s |
| Signal lost | status `online` but no heartbeat for ≥ 8 s (faster than the ~30 s Last Will) |
| Offline | status `offline` (Last Will) or no message at all for > 60 s |
| Link quality | heartbeats received / expected over the last 60 s (expected 30), scaled while fewer than 60 s have been observed |
| GPS | *Live fix* if the position changed in the last 60 s, *Last known* if unchanged, *No fix* if the latest telemetry is null |

Transitions are recorded as status events after a 10 s warm-up and never while the broker link is down
(device states are frozen and the UI says so), so dashboard restarts and outages don't log false events.

---

## API

All routes except `/api/health` and `/api/auth/login` require the session cookie (checked in
`src/proxy.ts` and again in each handler).

| Route | |
|---|---|
| `GET /api/stream` | SSE: `snapshot` (devices, last 50 events, all unacknowledged SOS, stats, broker), then `device.updated`, `position.added`, `event.added`, `event.acknowledged`, `stats.updated`, `broker.updated`; `: ping` comment every 15 s |
| `GET /api/devices`, `GET/PATCH /api/devices/[id]` | list / detail / rename (`{"displayName": "…" \| null}`) |
| `GET /api/devices/[id]/track?from=&to=` | positions for the trail (epoch ms or ISO) |
| `GET /api/devices/[id]/heartbeats?since=` | per-minute heartbeat summaries |
| `GET /api/events?deviceId=&type=sos,motion&from=&to=&cursor=&limit=&transient=0&format=csv` | keyset-paginated, newest first; `format=csv` exports |
| `POST /api/events/[id]/ack` | `{"includeEarlier": true}` also closes the incident's earlier presses |
| `GET /api/health` | public: broker state, last message time (503 while the broker is down) |

---

## Development

```bash
npm test               # vitest: schemas vs. real payloads, derivation, engine + in-memory SQLite
npm run lint           # eslint
npm run typecheck
npm run db:generate    # after editing src/lib/server/db/schema.ts (migrations apply on start)
npm run screenshots -- --label demo --keyless --device sim-001
```

`npm run screenshots` captures the main pages at 390×844, 820×1180 and 1440×900 and reports console
errors and horizontal overflow. `--keyless` (test-time only) loads Google Maps without a key so markers,
trails and overlays render in Google's dimmed “for development purposes only” mode.

Notes:
- Next.js 16 renamed `middleware.ts` to **`proxy.ts`**; the auth gate lives in `src/proxy.ts`.
- `cacheComponents` is on. Pages are client-rendered shells fed by the SSE store; route handlers read the
  request before touching the bridge so `next build` never starts it.

### Layout

```
src/lib/contract/schemas.ts   zod schemas + topic parsing (the firmware contract)
src/lib/domain/               derived status, link quality, reboot detection, UI wording
src/lib/server/engine.ts      ingest → SQLite → derived state → bus (no MQTT/HTTP, unit-tested)
src/lib/server/bridge.ts      mqtt.js client, reconnect/backoff, 1 s ticker, retention job
src/lib/server/db/            Drizzle schema, client (auto-migrate), repository
src/app/api/                  SSE + REST route handlers
src/components/map/           Google Maps: shell, markers, polyline, info cards, camera helpers
scripts/                      simulator, local broker, screenshot runner
drizzle/                      SQL migrations
```
