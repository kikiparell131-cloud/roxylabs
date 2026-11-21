# JavaScript API modules

Place one trusted CommonJS module per file in this folder, for example `ai.js` or `scraper.js`. Railway discovers these files at startup, but discovery does **not** publish or expose them.

Required exports:
- `name`
- `path` (must begin with `/api/v1/`)
- `method` (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`)
- `category`
- `plan` (`Free`, `Premium`, or `Both`)
- `description`
- `execute(req, res)`

After adding/committing a `.js` module, redeploy Railway. Then sign in as the `owner`, open Admin Dashboard → Endpoint Management → Add endpoint, select the discovered file, choose its access plan, and register it. The backend immediately connects the selected module handler to its route and the frontend `/docs` catalog. Until registered, the module is not listed publicly and its route returns `ENDPOINT_NOT_REGISTERED`.

Example module: `ai.js`. Do not upload arbitrary JavaScript through a public browser form; only trusted code committed and deployed to Railway is executable.
