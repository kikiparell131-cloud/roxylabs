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

## FotoLive Converter (`fotolive.js`)

`POST /api/v1/fotolive` accepts one video upload (`multipart/form-data`, field `video`) up to **5 MiB**.

It returns two usable forms:

- `result.gallery`: a single `.MP.jpg` Motion Photo container containing a JPEG still, appended H.264/AAC MP4, current GContainer XMP directory metadata, and legacy Google Camera `MicroVideoOffset` metadata for wider gallery compatibility. Use `gallery.data` (Base64) or `gallery.dataUrl` to save the complete moving-photo file. The browser preview displays only the still frame; the appended MP4 is inside the downloaded file. Gallery recognition depends on the Android gallery app/device.
- `result.whatsapp`: separate JPEG and MP4 components plus Baileys pairing values (`imagePairedMediaType: 5`, `videoPairedMediaType: 6`, `associationType: 12`). A WhatsApp bot uploads these components through Baileys and relays the paired messages; the API itself does not send WhatsApp messages.

The `result.image` is only a still preview. Download `result.gallery`, not `result.image`, when you want the moving Motion Photo file. For WhatsApp, use `result.whatsapp.image` and `result.whatsapp.video` as two media uploads and relay them using the same Baileys message-association sequence as the original bot module.

Example:

```bash
curl -X POST "https://YOUR-RAILWAY-DOMAIN/api/v1/fotolive" \
  -H "x-api-key: YOUR_API_KEY" \
  -F "video=@clip.mp4"
```

The upload limit applies to the original video. Output size can differ because the video is normalized to H.264/AAC MP4.
