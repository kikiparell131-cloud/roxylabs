# Roxy API modules

Each top-level `.js` file in this directory is a CommonJS endpoint module discovered by `backend/src/server.ts`. Modules export `name`, `path`, `method`, `category`, `plan`, `description`, and `execute(req, res)`. The Roxy server handles API-key authentication, plan checks, quota enforcement, and usage logging before calling `execute`.

## Downloader endpoints

All endpoints below are independent modules under the `Downloader` category. Most use `GET` with `q`.

| Endpoint | Input | Implementation |
|---|---|---|
| `/api/v1/downloader/facebook` | `q=<Facebook URL>` | Converted from `raw/down-facebook.js` scraper |
| `/api/v1/downloader/instagram` | `q=<Instagram URL>` | Converted from `raw/down-instagram.js` scraper |
| `/api/v1/downloader/instagram/audio` | `q=<Instagram Reel URL>` | Converted from `raw/down-igmp3.js` |
| `/api/v1/downloader/twitter` | `q=<X/Twitter URL>` | Converted from `raw/downloader-twitter.js` |
| `/api/v1/downloader/threads` | `q=<Threads URL>` | Converted from `raw/down-threads.js` |
| `/api/v1/downloader/terabox` | `q=<TeraBox URL>` | Converted from `raw/downloader-terabox.js` |
| `/api/v1/downloader/mediafire` | `q=<MediaFire URL>` | Converted from `raw/down-mediafire.js` |
| `/api/v1/downloader/sfile` | `q=<keyword or Sfile URL>` | Converted from `raw/down-sfile.js`; optional `page` |
| `/api/v1/downloader/soundcloud` | `q=<keyword or SoundCloud URL>` | Converted from `raw/down-soundcloud.js`; optional `limit` |
| `/api/v1/downloader/myinstants` | `q=<keyword>` | Converted from `raw/down-myinstants.js`; optional `slug` for detail |
| `/api/v1/downloader/youtube` | `q=<YouTube URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/youtube/mp3` | `q=<YouTube URL>` | Uses shared yt-dlp resolver, audio formats only |
| `/api/v1/downloader/tiktok` | `q=<TikTok URL>` | Existing module intentionally unchanged |
| `/api/v1/downloader/pinterest` | Existing module input | Existing module intentionally unchanged |
| `/api/v1/downloader/gdrive` | `q=<public Google Drive URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/bilibili` | `q=<public Bilibili URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/reddit` | `q=<public Reddit URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/likee` | `q=<public Likee URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/tumblr` | `q=<public Tumblr URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/vimeo` | `q=<public Vimeo URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/twitch` | `q=<public Twitch URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/snapchat` | `q=<public Snapchat URL>` | Uses shared yt-dlp resolver |
| `/api/v1/downloader/dailymotion` | `q=<public Dailymotion URL>` | Uses shared yt-dlp resolver |

## JSON response

Success: `{ "success": true, "api": "roxylabs", "platform": "...", "result": ... }`.

Errors: `{ "success": false, "api": "roxylabs", "code": "...", "message": "..." }`.

Media URLs returned by third-party providers may expire. Provider availability and support can change; no scraper can guarantee every public link will resolve at all times. Use only content you own or have permission to download. Private content and access controls are not bypassed.

## Runtime dependencies

The backend uses `axios`, `cheerio`, `form-data`, `multer`, and the system `yt-dlp` executable. Railway Nixpacks installs `yt-dlp` and FFmpeg. The TikTok and Pindl modules are intentionally preserved unchanged in this update.
