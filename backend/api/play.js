/**
 * Roxy Play API
 * GET /api/v1/youtube/play?q=artist%20song
 *
 * Searches one YouTube result, requests an audio conversion from SaveTube's
 * public CDN, stores the returned audio temporarily in private Supabase Storage,
 * and exposes a branded download URL for 30 minutes.
 *
 * Note: SaveTube is a third-party service, not an official YouTube API. Its
 * endpoints/response format can change or become unavailable. Only use this
 * endpoint for audio you own or are authorized to download.
 */
const { createDecipheriv, randomBytes } = require('crypto');
const yts = require('yt-search');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.ROXY_PLAY_BUCKET || 'roxy-play';
const TTL_SECONDS = 30 * 60;
const MAX_AUDIO_BYTES = Number(process.env.ROXY_PLAY_MAX_BYTES || 30 * 1024 * 1024);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL = String(process.env.PLAY_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const SAVE_TUBE_KEY = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
const SAVE_TUBE_HEADERS = {
  'content-type': 'application/json',
  origin: 'https://yt.savetube.me',
  'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'
};

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function slugify(value) {
  return String(value || 'audio').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 90) || 'audio';
}

async function fetchJson(url, options = {}, timeout = 25000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`SaveTube HTTP ${response.status}`);
  return response.json();
}

function extractVideoId(value) {
  try {
    const parsed = new URL(value);
    let id = parsed.searchParams.get('v');
    if (!id && /youtu\.be$/i.test(parsed.hostname)) id = parsed.pathname.split('/').filter(Boolean)[0];
    if (!id) {
      const match = parsed.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
      id = match?.[1];
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

async function savetube(videoUrl, { quality = '128kbps' } = {}) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('URL YouTube tidak valid');

  const cdnInfo = await fetchJson('https://media.savetube.vip/api/random-cdn', {
    headers: SAVE_TUBE_HEADERS
  });
  if (!cdnInfo?.cdn || !/^[a-z0-9.-]+$/i.test(cdnInfo.cdn)) {
    throw new Error('SaveTube CDN tidak tersedia');
  }

  const cdnOrigin = `https://${cdnInfo.cdn}`;
  const info = await fetchJson(`${cdnOrigin}/v2/info`, {
    method: 'POST',
    headers: SAVE_TUBE_HEADERS,
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` })
  });
  if (!info?.data || typeof info.data !== 'string') throw new Error('Metadata SaveTube kosong');

  let metadata;
  try {
    const encrypted = Buffer.from(info.data, 'base64');
    if (encrypted.length <= 16) throw new Error('Encrypted metadata tidak lengkap');
    const decipher = createDecipheriv('aes-128-cbc', SAVE_TUBE_KEY, encrypted.subarray(0, 16));
    const decrypted = Buffer.concat([
      decipher.update(encrypted.subarray(16)),
      decipher.final()
    ]);
    metadata = JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new Error('Dekripsi metadata SaveTube gagal');
  }
  if (!metadata?.key) throw new Error('Key download SaveTube tidak ditemukan');

  const download = await fetchJson(`${cdnOrigin}/download`, {
    method: 'POST',
    headers: SAVE_TUBE_HEADERS,
    body: JSON.stringify({
      id: videoId,
      downloadType: 'audio',
      quality,
      key: metadata.key
    })
  });
  const downloadUrl = download?.data?.downloadUrl;
  if (typeof downloadUrl !== 'string') {
    throw new Error(download?.message || 'SaveTube tidak mengembalikan URL audio');
  }

  const parsed = new URL(downloadUrl);
  if (parsed.protocol !== 'https:') throw new Error('URL audio provider harus HTTPS');

  return {
    title: String(metadata.title || '').slice(0, 200),
    duration: metadata.durationLabel || null,
    thumbnail: metadata.thumbnail || null,
    url: parsed.toString()
  };
}

async function savetubeRetry(videoUrl, options, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await savetube(videoUrl, options);
    } catch (error) {
      lastError = error;
      console.warn(`[play] SaveTube attempt ${attempt + 1}/${retries} failed:`, error?.message || error);
    }
  }
  throw lastError || new Error('SaveTube gagal memproses audio');
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
  description: 'Search one song, process audio through SaveTube, store it temporarily in Supabase, and return a 30-minute download link.',
  async execute(req, res) {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) return res.status(400).json({ success: false, code: 'QUERY_REQUIRED', message: 'Enter a song title or artist using q.' });
    if (query.length > 100) return res.status(400).json({ success: false, code: 'QUERY_TOO_LONG', message: 'Search query must be 100 characters or fewer.' });
    if (!supabase) return res.status(503).json({ success: false, code: 'SUPABASE_NOT_CONFIGURED', message: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
    if (!PUBLIC_BASE_URL) return res.status(503).json({ success: false, code: 'PLAY_PUBLIC_BASE_URL_NOT_CONFIGURED', message: 'Configure PLAY_PUBLIC_BASE_URL to your public Vercel domain.' });

    try {
      const search = await yts(query);
      const video = search?.videos?.[0];
      if (!video?.url) return res.status(404).json({ success: false, code: 'SONG_NOT_FOUND', message: 'No matching song was found.' });

      const audio = await savetubeRetry(video.url, { quality: '128kbps' }, 3);
      const audioResponse = await fetch(audio.url, {
        signal: AbortSignal.timeout(60_000),
        redirect: 'follow'
      });
      if (!audioResponse.ok) throw new Error(`Gagal mengambil file audio (HTTP ${audioResponse.status})`);
      const declaredLength = Number(audioResponse.headers.get('content-length') || 0);
      if (declaredLength > MAX_AUDIO_BYTES) {
        return res.status(413).json({ success: false, code: 'AUDIO_TOO_LARGE', message: 'Audio file exceeds the configured size limit.' });
      }
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      if (!audioBuffer.length || audioBuffer.length > MAX_AUDIO_BYTES) {
        return res.status(413).json({ success: false, code: 'AUDIO_TOO_LARGE', message: 'Audio file is empty or exceeds the configured size limit.' });
      }

      const title = String(audio.title || video.title).slice(0, 200);
      const filename = `${slugify(title)}-${randomBytes(5).toString('hex')}.mp3`;
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
          title,
          artist: video.author?.name || null,
          videoId: video.videoId,
          youtubeUrl: video.url,
          duration: audio.duration || video.timestamp || null,
          thumbnail: audio.thumbnail || video.thumbnail || null,
          filename,
          mimetype: 'audio/mpeg',
          downloadUrl: `${PUBLIC_BASE_URL}/roxy/play/${encodeURIComponent(filename)}`,
          expiresAt,
          expiresInSeconds: TTL_SECONDS,
          storage: 'Supabase Storage'
        }
      });
    } catch (error) {
      console.error('[play] request failed:', error?.message || error);
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return res.status(timedOut ? 504 : 502).json({
        success: false,
        code: timedOut ? 'PLAY_TIMEOUT' : 'PLAY_PROCESSING_FAILED',
        message: 'Could not process this song right now. The audio service may be unavailable; please try again later.'
      });
    }
  }
};
