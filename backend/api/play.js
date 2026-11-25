/**
 * Roxy Play API
 * GET /api/v1/youtube/play?q=artist%20song
 *
 * Search returns exactly one YouTube result. Audio is obtained only from a
 * configured provider that you control / are authorized to use, then copied to
 * Supabase Storage and automatically removed after 30 minutes.
 */
const yts = require('yt-search');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const BUCKET = process.env.ROXY_PLAY_BUCKET || 'roxy-play';
const TTL_SECONDS = 30 * 60;
const MAX_AUDIO_BYTES = Number(process.env.ROXY_PLAY_MAX_BYTES || 30 * 1024 * 1024);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROVIDER_URL = process.env.ROXY_AUDIO_PROVIDER_URL;
const PUBLIC_BASE_URL = String(process.env.PLAY_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function slugify(value) {
  return String(value || 'audio').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 90) || 'audio';
}

async function cleanupExpired() {
  if (!supabase) return;
  const now = new Date().toISOString();
  const { data: expired, error } = await supabase
    .from('roxy_play_files').select('id, storage_path').lte('expires_at', now).limit(100);
  if (error) {
    console.error('[play] cleanup query failed:', error.message);
    return;
  }
  if (!expired?.length) return;
  const paths = expired.map(row => row.storage_path);
  const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
  if (removeError) {
    console.error('[play] storage cleanup failed:', removeError.message);
    return;
  }
  const ids = expired.map(row => row.id);
  const { error: deleteError } = await supabase.from('roxy_play_files').delete().in('id', ids);
  if (deleteError) console.error('[play] cleanup record delete failed:', deleteError.message);
}

// Best-effort in-process cleanup; SQL also includes a cleanup function so it can
// be scheduled by Supabase/Railway even when this process restarts.
if (supabase && !global.__roxyPlayCleanupTimer) {
  global.__roxyPlayCleanupTimer = setInterval(() => cleanupExpired().catch(console.error), 60_000);
  if (global.__roxyPlayCleanupTimer.unref) global.__roxyPlayCleanupTimer.unref();
  cleanupExpired().catch(console.error);
}

module.exports = {
  name: 'YouTube Play Audio',
  path: '/api/v1/youtube/play',
  method: 'GET',
  category: 'Downloader',
  plan: 'Both',
  description: 'Search one song, process authorized audio, store it temporarily in Supabase, and return a 30-minute download link.',
  async execute(req, res) {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) return res.status(400).json({ success: false, code: 'QUERY_REQUIRED', message: 'Enter a song title or artist using q.' });
    if (query.length > 100) return res.status(400).json({ success: false, code: 'QUERY_TOO_LONG', message: 'Search query must be 100 characters or fewer.' });
    if (!supabase) return res.status(503).json({ success: false, code: 'SUPABASE_NOT_CONFIGURED', message: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
    if (!PROVIDER_URL) return res.status(503).json({ success: false, code: 'AUDIO_PROVIDER_NOT_CONFIGURED', message: 'Configure ROXY_AUDIO_PROVIDER_URL with an audio provider you are authorized to use.' });
    if (!PUBLIC_BASE_URL) return res.status(503).json({ success: false, code: 'PLAY_PUBLIC_BASE_URL_NOT_CONFIGURED', message: 'Configure PLAY_PUBLIC_BASE_URL to your public Vercel domain.' });

    try {
      const search = await yts(query);
      const video = search?.videos?.[0];
      if (!video) return res.status(404).json({ success: false, code: 'SONG_NOT_FOUND', message: 'No matching song was found.' });

      // Provider must return a direct audio URL for content the operator has
      // rights/permission to download. Do not use this API to bypass restrictions.
      const providerResponse = await fetch(PROVIDER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.ROXY_AUDIO_PROVIDER_TOKEN ? { authorization: `Bearer ${process.env.ROXY_AUDIO_PROVIDER_TOKEN}` } : {}) },
        body: JSON.stringify({ videoId: video.videoId, sourceUrl: video.url, title: video.title, format: 'mp3', quality: '128kbps' }),
        signal: AbortSignal.timeout(45_000)
      });
      if (!providerResponse.ok) return res.status(502).json({ success: false, code: 'AUDIO_PROVIDER_FAILED', message: 'Audio provider could not process this track.' });
      const providerData = await providerResponse.json();
      const audioUrl = providerData?.audioUrl || providerData?.url;
      if (typeof audioUrl !== 'string') return res.status(502).json({ success: false, code: 'AUDIO_URL_MISSING', message: 'Audio provider did not return an audio URL.' });
      const parsedAudioUrl = new URL(audioUrl);
      if (parsedAudioUrl.protocol !== 'https:') return res.status(502).json({ success: false, code: 'INVALID_AUDIO_URL', message: 'Provider audio URL must use HTTPS.' });

      const audioResponse = await fetch(parsedAudioUrl, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
      if (!audioResponse.ok) return res.status(502).json({ success: false, code: 'AUDIO_FETCH_FAILED', message: 'Could not retrieve audio from the configured provider.' });
      const declaredLength = Number(audioResponse.headers.get('content-length') || 0);
      if (declaredLength > MAX_AUDIO_BYTES) return res.status(413).json({ success: false, code: 'AUDIO_TOO_LARGE', message: 'Audio file exceeds the configured size limit.' });
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      if (!audioBuffer.length || audioBuffer.length > MAX_AUDIO_BYTES) return res.status(413).json({ success: false, code: 'AUDIO_TOO_LARGE', message: 'Audio file is empty or exceeds the configured size limit.' });

      const title = String(providerData.title || video.title).slice(0, 200);
      const filename = `${slugify(title)}-${crypto.randomBytes(5).toString('hex')}.mp3`;
      const storagePath = `${new Date().toISOString().slice(0, 10)}/${filename}`;
      const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, audioBuffer, {
        contentType: 'audio/mpeg', upsert: false, cacheControl: '1800'
      });
      if (uploadError) {
        console.error('[play] Supabase upload failed:', uploadError.message);
        return res.status(502).json({ success: false, code: 'STORAGE_UPLOAD_FAILED', message: 'Could not store audio in temporary storage.' });
      }

      const { error: rowError } = await supabase.from('roxy_play_files').insert({
        storage_path: storagePath, filename, title, expires_at: expiresAt
      });
      if (rowError) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        console.error('[play] expiry record insert failed:', rowError.message);
        return res.status(502).json({ success: false, code: 'EXPIRY_RECORD_FAILED', message: 'Could not register automatic file cleanup.' });
      }

      return res.json({
        success: true,
        query,
        result: {
          title, artist: video.author?.name || null,
          videoId: video.videoId, youtubeUrl: video.url,
          duration: video.timestamp || null, thumbnail: video.thumbnail || null,
          filename, mimetype: 'audio/mpeg',
          downloadUrl: `${PUBLIC_BASE_URL}/roxy/play/${encodeURIComponent(filename)}`,
          // The storage signed URL is intentionally not exposed; the Vercel route proxies the file.
          expiresAt,
          expiresInSeconds: TTL_SECONDS,
          storage: 'Supabase Storage'
        }
      });
    } catch (error) {
      console.error('[play] request failed:', error?.message || error);
      return res.status(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 502)
        .json({ success: false, code: 'PLAY_PROCESSING_FAILED', message: 'Could not process this song right now. Please try again later.' });
    }
  }
};
