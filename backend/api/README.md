# JavaScript API modules

Put one trusted CommonJS module per file in this folder, for example `ai.js` or `scraper.js`.
The Express service loads `*.js` files in this folder when Railway starts.

Required exports:
- `name`
- `path` (must begin with `/api/v1/`)
- `method` (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`)
- `category`
- `plan` (`Free`, `Premium`, or `Both`)
- `description`
- `execute(req, res)`

Example module: `scraper.example.js`. Rename/copy it to `scraper.js` after implementing it.
Changes to code modules must be committed and redeployed to Railway. They are not uploaded/executed from the public admin UI. The admin UI manages endpoint documentation metadata only; this separation prevents arbitrary code execution on your production server.
