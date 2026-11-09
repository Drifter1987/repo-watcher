# Repo Watcher

A single-page watcher for GitHub repositories: every project above 100k stars,
plus the 20 fastest-rising projects created in the last seven days, refreshed
every 12 hours and tracked over time on the device.

## What it shows

- **100k+ stars** — every repository above 100k stars (about 140 today),
  ranked by total stars; the search box filters across all of them.
- **Trending this week** — repositories created in the last 7 days, ranked by
  stars, with a stars-per-day figure as the trending score.
- **Tracking** — tap any repository for its detail view: stars, forks, open
  issues, age, plus an interactive chart of star or fork growth with a
  draggable crosshair, range presets (24h / 7d / 30d / 90d / all) and a
  Total vs Growth scale toggle.

## Data

Everything comes from the public GitHub REST API, no key required:

- `GET /search/repositories?q=stars:>=100000 archived:false&sort=stars&order=desc&per_page=100&page=N`
  — paginated until the whole 100k+ set is loaded
- `GET /search/repositories?q=created:>=<7 days ago> stars:>=5 archived:false&sort=stars&order=desc&per_page=20`
- `GET /rate_limit` (does not count against the quota)

A refresh costs three or four search requests (two or three pages plus the
trending query), so the unauthenticated allowance of 10 searches a minute is
plenty for a refresh every 12 hours.

## Refresh and history

The lists are fetched on first open and then every 12 hours; the countdown
under the header shows the next sync, and the refresh button forces one early.
The cached lists survive a reload, so the app opens instantly.

Each refresh appends a snapshot (timestamp, stars, forks) for every tracked
repository to `localStorage`. Growth is computed between snapshots: a chip in
the list shows the change over seven days (or since tracking started, labelled
as such), and the detail chart draws the stored series. History is capped at
240 points per repository, thinning the older half as it grows.

Nothing is estimated or back-filled: the first snapshot starts the timeline,
the second shows the first real delta.

## Rate limits and the optional token

Without a token GitHub allows 10 searches a minute — enough for the scheduled
refresh. A personal access token, set in Settings, raises the limits and is
kept only in this browser's `localStorage`. Rate limit errors are shown in a
banner with the reset time.

## Files

- `index.html` — markup and the script order
- `styles.css` — dark theme, responsive layout
- `js/store.js` — cache, snapshot history and settings in `localStorage`
- `js/api.js` — GitHub REST client, queries and error handling
- `js/chart.js` — dependency-free SVG line chart with crosshair and tooltip
- `js/app.js` — rendering, filters, detail view and the 12-hour scheduler

## Running

Open `index.html` — no build step, no dependencies. It runs from a static file
server or straight from the filesystem; it needs a network connection the first
time it syncs.
