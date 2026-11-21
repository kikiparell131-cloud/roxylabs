# JavaScript API modules

Place one trusted CommonJS module per file in this folder, for example `ai.js` or `scraper.js`. Railway discovers these files at startup and automatically registers/publishes them.

Required exports:
- `name`
- `path` (must begin with `/api/v1/`)
- `method` (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`)
- `category`
- `plan` (`Free`, `Premium`, or `Both`)
- `description`
- `execute(req, res)`

After adding/committing a `.js` module, redeploy Railway. On startup, the backend automatically discovers it, inserts its endpoint metadata into `api_endpoints`, activates its handler, and publishes it in the frontend `/docs` catalog. No manual registration step is needed. Existing endpoint settings (name, category, access plan, and disabled state) are preserved. To change those settings, use the Admin Dashboard. New files must still be trusted code committed to the backend repository; the browser dashboard does not execute arbitrary uploaded JavaScript.

Example module: `ai.js`. Do not upload arbitrary JavaScript through a public browser form; only trusted code committed and deployed to Railway is executable.

## Pinterest Search (`pinsearch.js`)

GET `/api/v1/pinterest/search?q=elaina&limit=5&type=image`

Query parameters: `q` (required keyword), `limit` (1–30, default 10), and `type` (`all`, `image`, or `video`). The module extracts publicly exposed results from Pinterest's search page; Pinterest may rate-limit requests or change its markup, so results are not guaranteed. Media links can expire. Use only content you own or have permission to use.

## YouTube Play Search (`play.js`)

GET `/api/v1/youtube/play?q=chase+atlantic&limit=5`

Searches YouTube by song title or artist and returns JSON metadata (title, video URL, duration, views, author, thumbnail, and upload age). `q` is required; `limit` is 1–10 and defaults to 5. This endpoint returns official watch URLs, not an audio file.
