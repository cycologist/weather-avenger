# Avercast

Avercast compares several free weather services for any place on Earth and shows one consensus forecast. Pick a location on the world map, search for a city, or use your current position. The main screen shows the average, lowest and highest forecast for temperature, wind, humidity and precipitation over the next seven days, and the 7-day chart can switch between temperature, precipitation, and wind strength with direction.

No API keys are required.

## Quick start

```bash
npm install
npm start
```

Open <http://localhost:4173>.

Node.js 20 or newer is recommended. For development with automatic restarts:

```bash
npm run dev
```

## What it does

- **Location** — world map with pan/zoom and click-to-pick, place search, and browser geolocation. On first launch the app asks for your position and starts there; if you decline, Berlin is used as a fallback. A place you pick is remembered in `localStorage`, together with the theme.
- **Chart switcher** — the 7-day ensemble chart toggles between temperature (line plus low–high band), precipitation (daily-total bars with the source range), and wind (mean-speed line, source range, and a direction arrow for every day). The last choice is remembered.
- **Weather services menu** — a source list with enable/disable switches and delete confirmation. Add more services from a scanned catalog.
- **Scraped catalog** — on startup the server reads the Weather section of the [public-apis](https://github.com/public-apis/public-apis) README and keeps the result for 24 hours. Supported services are matched by host and name. The *All scanned* tab shows every entry found, including services that have no adapter yet. If the scrape fails, a bundled list is used.
- **Consensus forecast** — each enabled service counts once per day. Temperature and the other values are aggregated per calendar day in the location's timezone.
- **Source contributions** — an expandable table shows which services reported, how many days each supplied, their status (live, cached or failed), and any adapter notes.

### Included services

| Service | Coverage | Notes |
| --- | --- | --- |
| Open-Meteo | 16 days | Default "best match" blend; keyless |
| MET Norway | 10 days | Locationforecast; requires a descriptive `User-Agent` |
| 7Timer! | 8 days (sliced to 7) | Wind and rain are coarse bands converted to midpoints |
| wttr.in | 3 days | Compact JSON forecast |
| Open-Meteo · ECMWF | 15 days | Optional extra model using the `ecmwf_ifs025` model |
| Open-Meteo · ICON | 7 days | Optional extra model using DWD ICON |

ECMWF and ICON are separate catalog entries that can be added, so their model output is counted as its own source rather than merged into the default Open-Meteo row.

## How the numbers are combined

For every day, across the services that returned a value:

- **Temperature** — the average is the mean of each model's daily mean (`(low + high) / 2`). The low is the lowest daily low reported, and the high is the highest daily high. The "spread" shown in the hero card is the difference between the warmest and coolest model daily mean.
- **Wind** — average of daily mean wind speeds, with the lowest and highest daily mean across services. The direction is the circular mean of each service's daily mean bearing, so 350° and 10° average to 0° rather than 180°; it is shown as a 16-point compass point. The arrow points where the wind is blowing to, while the label and tooltip give the direction it comes from. The spread is the widest deviation of any service from that mean, and services without a bearing are skipped for the direction only.
- **Humidity** — average of daily mean relative humidity (daily values are averaged from hourly data where available).
- **Precipitation** — average of daily totals, with the lowest and highest daily total.

Missing values are ignored for that metric; a service is never invented as zero. Days without any service are dropped. Wind bearings are circular values and are averaged with unit vectors, not arithmetic means.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service and source counts |
| `GET /api/sources` | Sources in the menu |
| `POST /api/sources` | Add a source: `{ "catalogId": "open-meteo-ecmwf" }` |
| `PATCH /api/sources/:id` | Enable or disable: `{ "enabled": false }` |
| `DELETE /api/sources/:id` | Remove a source |
| `GET /api/catalog` | Scraped catalog, supported entries and all scanned rows |
| `POST /api/catalog/refresh` | Force a fresh scrape |
| `GET /api/forecast?lat=52.52&lon=13.405&days=7` | Aggregated forecast; add `refresh=1` to bypass caches |
| `GET /api/geocode?q=Lisbon` | Place search (Open-Meteo geocoding) |
| `GET /api/reverse?lat=38.72&lon=-9.15` | Reverse geocoding (BigDataCloud, then Nominatim) |

Forecasts are cached for 5 minutes, individual source responses for 15 minutes, and timezone lookups for 24 hours.

Each `daily` entry contains `wind: { avg, min, max, direction, directionText, directionSpread, directionCount }`, where `direction` is the meteorological bearing in degrees (0 = north, the direction the wind comes from) and `directionText` is its 16-point compass label. `directionSpread` is the widest deviation between services, and `directionCount` is how many services reported a bearing.

## Configuration

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | HTTP port |
| `DATA_DIR` | `./data` | Where the source list and scraped catalog are stored |
| `CONTACT_EMAIL` | empty | If set, MET Norway requests send `Avercast/1.0 (contact: you@example.com)` as the User-Agent |

Example:

```bash
CONTACT_EMAIL=you@example.com PORT=8080 npm start
```

## Project layout

```text
server/
  index.js          Express app and routes
  scraper.js        public-apis scraper, catalog cache and fallback
  store.js          Source menu persistence (data/sources.json)
  forecast.js       Node wrapper around the shared forecast engine
public/
  index.html        App shell and dialogs
  app.js            UI controller
  map.js            SVG world map (Natural Earth 110m data)
  styles.css        Light/dark theme and responsive layout
  local-api.js      In-app /api implementation for the Android build
  lib/              Shared forecast engine: adapters, aggregation,
                    wind bearings, geocoding, timezone, HTTP helpers and
                    catalog parser
  data/             Natural Earth world.geojson
android/            Capacitor Android project
test/               node:test tests for aggregation and scraping
```

The frontend is plain HTML, CSS and ES modules; there is no build step. Express only serves static files and the JSON API. The same `public/lib` engine runs in both the server and the app.

## Tests

```bash
npm test
```

The tests cover the aggregation rules (including disagreement, missing values, date filtering and circular wind directions), the wind bearing helpers, and the public-apis Markdown scraper.

## Android app

Avercast also has a Capacitor Android shell. The Android build uses the shared
HTML/CSS/JavaScript UI and runs the forecast engine directly in the app, so the
Node/Express server is not required on a phone. Weather and geocoding requests
go directly to the public services through Capacitor's native HTTP bridge.

The slim local toolchain is installed under `~/Android`:

- OpenJDK 21: `~/Android/jdk-21`
- Android SDK: `~/Android/Sdk`
- Android platform/build tools 35
- Android emulator and Google APIs API 35 image

Build and optionally install the debug APK:

```bash
./scripts/build-android.sh
```

The resulting APK is copied to:

```text
~/Android/Avercast/Avercast-debug.apk
```

To use the Android command-line tools manually in a terminal:

```bash
source scripts/android-env.sh
adb devices
npx cap sync android
npm run android:build
```

The configured emulator is named `avercast`. Start it with:

```bash
source scripts/android-env.sh
emulator -avd avercast
```

The debug package ID is `com.matthias.avercast`. This is a sideload/debug
build, not a Play Store release; a release signing key and app bundle can be
added later if you decide to publish it.

## Notes and limitations

- These are model forecasts, not official warnings. Check a national weather service for alerts.
- Free services can be slow, rate-limited or temporarily unavailable. Failed sources are excluded from the consensus and reported in *Source contributions*. A stale cached response may be reused instead of failing the whole forecast.
- wttr.in only provides three days, so later days have one fewer source. 7Timer's wind and rain bands are approximations, and MET Norway precipitation late in its range is derived from six-hour totals.
- Location coordinates are sent to the public weather and geocoding services used by the app. There is no account, tracking or server-side user database.
- MET Norway asks clients to identify themselves; set `CONTACT_EMAIL` if you deploy this beyond local use.

Map outline: [Natural Earth](https://www.naturalearthdata.com/). Weather data: Open-Meteo, MET Norway, 7Timer! and wttr.in, under their respective terms.

## License

MIT
