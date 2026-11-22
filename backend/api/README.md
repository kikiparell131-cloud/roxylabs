# Roxy API modules

Each `.js` file in this directory is a trusted CommonJS endpoint module. Roxy discovers the modules on backend startup. A new module is inserted into `api_endpoints`; activate/configure it from the Admin Dashboard if required. The frontend docs catalog reads the registered endpoint metadata.

## Downloader endpoints
All downloader endpoints use `GET` and the `q` query parameter. Example:
`/api/v1/downloader/facebook?q=https%3A%2F%2Fwww.facebook.com%2F...`

Available modules:
- `/api/v1/downloader/facebook`
- `/api/v1/downloader/instagram`
- `/api/v1/downloader/tiktok`
- `/api/v1/downloader/youtube`
- `/api/v1/downloader/youtube/mp3`
- `/api/v1/downloader/instagram/audio`
- `/api/v1/downloader/twitter`
- `/api/v1/downloader/threads`
- `/api/v1/downloader/bilibili`
- `/api/v1/downloader/terabox`
- `/api/v1/downloader/gdrive`
- `/api/v1/downloader/mediafire`
- `/api/v1/downloader/soundcloud`
- `/api/v1/downloader/reddit`
- `/api/v1/downloader/dailymotion`
- `/api/v1/downloader/vimeo`
- `/api/v1/downloader/twitch`
- `/api/v1/downloader/likee`
- `/api/v1/downloader/tumblr`
- `/api/v1/downloader/snapchat`
- `/api/v1/downloader/sfile`
- `/api/v1/downloader/myinstants` (keyword search)
- `/api/v1/downloader/pinterest`

Most platform resolvers use `yt-dlp` to obtain public metadata and temporary direct media URLs. Install `yt-dlp` in the Railway runtime. Some platforms may require cookies or may not be supported by the installed yt-dlp version. Links can expire. Do not use these endpoints to access private content or content without permission.

## JSON response
Success responses use `{ success: true, platform, result }`. Errors use `{ success: false, code, message }`. Roxy's server adds `api: "roxylabs"` to JSON responses and applies the existing API-key authentication, plan/quota checks, and usage logging.

## Runtime dependencies
`axios`, `cheerio`, and `yt-dlp` (system executable) are required by the downloader modules. The `api/lib` directory contains shared helpers and is not itself an endpoint.
