# Roxy Play API setup

Endpoint: `GET /api/v1/youtube/play?q=artist%20song`

The API returns one best YouTube search result, asks the configured authorized audio provider for an audio URL, downloads that audio into a private Supabase Storage bucket, and returns a branded Vercel download URL valid for 30 minutes. Vercel proxies the download to Railway; the Supabase signed URL remains server-side.

## Single-result behavior (fixed)
The `q` parameter searches by song title/artist, but the API selects and processes exactly one match (`videos.slice(0, 1)`). The JSON response contains one singular `result` object, never a `results` array. There is no `limit=5`, `limit=10`, or choice selector.

## Custom Vercel download domain
1. Set `PLAY_PUBLIC_BASE_URL=https://roxylabs.vercel.app` in Railway (replace with your actual Vercel domain).
2. Set `ROXY_BACKEND_ORIGIN=https://roxy-backend-production.up.railway.app` in Vercel project environment variables.
3. Deploy the frontend. The Next.js route at `frontend/app/roxy/play/[filename]/route.ts` proxies `https://roxylabs.vercel.app/roxy/play/name.mp3` to the Railway backend, which streams from private Supabase Storage.
4. Ensure the Vercel frontend and Railway backend are deployed from their respective project roots (`frontend` and `backend`).

## Supabase
1. Create a **private** Storage bucket named `roxy-play` (or set `ROXY_PLAY_BUCKET`).
2. Run `roxy-play-supabase.sql` in Supabase SQL Editor.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Railway variables. Never expose the service-role key in frontend code.

## Provider contract
Set `ROXY_AUDIO_PROVIDER_URL` to an endpoint you operate or are authorized to use. It receives JSON:

```json
{ "videoId": "...", "sourceUrl": "https://www.youtube.com/watch?v=...", "title": "...", "format": "mp3", "quality": "128kbps" }
```

It must respond with JSON containing a direct HTTPS audio URL:

```json
{ "audioUrl": "https://provider.example/temporary-audio.mp3", "title": "Song title" }
```

Use only audio you own, have permission to download, or that is offered under a license allowing this use. This API does not implement circumvention of YouTube restrictions.

## Expiration
The branded download URL is valid for 30 minutes. The backend checks the database expiry before streaming; Supabase signed URLs are created server-side for the proxy only. The API also runs a cleanup sweep once per minute and removes expired Storage objects and their database rows. Since an in-process timer can stop during a deploy/restart, configure a Supabase scheduled job or an external scheduled call to run cleanup regularly for strict cleanup guarantees. Signed URLs stop working at expiry even if a file cleanup is delayed.
