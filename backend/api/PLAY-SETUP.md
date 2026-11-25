# Roxy Play API setup

Endpoint: `GET /api/v1/youtube/play?q=artist%20song`

The endpoint searches YouTube and selects exactly one result, requests an audio conversion from SaveTube's public CDN, copies the returned MP3 into a private Supabase Storage bucket, and returns a branded Vercel download URL valid for 30 minutes.

## Important service note

This integration uses SaveTube, a third-party service that is not an official YouTube API. Its endpoints, CDN, metadata format, or availability may change without notice. No `ROXY_AUDIO_PROVIDER_URL` or provider token is required. Use this feature only for audio you own or have permission to download, and comply with the source platform's terms and applicable copyright rules.

## Custom Vercel download domain

1. Set `PLAY_PUBLIC_BASE_URL=https://your-vercel-domain.vercel.app` in Railway (no trailing slash).
2. Set `ROXY_BACKEND_ORIGIN=https://your-railway-backend.up.railway.app` in Vercel.
3. Deploy the frontend. The Next.js route at `frontend/app/roxy/play/[filename]/route.ts` proxies the download through Railway; the private Supabase URL is not exposed.
4. Ensure the Vercel frontend and Railway backend are deployed from their respective project roots (`frontend` and `backend`).

## Supabase

1. Create a **private** Storage bucket named `roxy-play` (or set `ROXY_PLAY_BUCKET`).
2. Run `roxy-play-supabase.sql` in Supabase SQL Editor.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Railway Variables. Never expose the service-role key in frontend code.

## Expiration

The branded download URL is valid for 30 minutes. The backend checks the database expiry before streaming. A cleanup sweep runs once per minute and removes expired Storage objects and database rows. For strict cleanup guarantees across deploys/restarts, also configure a scheduled cleanup job.
