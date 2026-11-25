/**
 * TikTok public-video metadata and download-link resolver.
 * Use only for public content you own or have permission to download.
 * Provider URLs are temporary and may expire; do not store them as permanent links.
 */
module.exports = {
  name: 'TikTok Downloader',
  path: '/api/v1/tiktok/download',
  method: 'POST',
  category: 'Downloader',
  plan: 'Both',
  description: 'Resolve a public TikTok video URL into metadata and available video/audio links.',
  async execute(req, res) {
    const input = req.body && req.body.url;
    if (typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ success: false, code: 'URL_REQUIRED', message: 'Paste a TikTok video URL.' });
    }

    let parsed;
    try { parsed = new URL(input.trim()); } catch {
      return res.status(400).json({ success: false, code: 'INVALID_URL', message: 'The URL is not valid.' });
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(
      host === 'tiktok.com' || host.endsWith('.tiktok.com')
    )) {
      return res.status(400).json({ success: false, code: 'TIKTOK_URL_REQUIRED', message: 'Only HTTPS TikTok URLs are accepted.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const form = new URLSearchParams({ url: parsed.toString(), hd: '1' });
      const response = await fetch('https://www.tikwm.com/api/', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'application/json',
          'user-agent': 'RoxyMainAPI/1.0'
        },
        body: form,
        signal: controller.signal
      });
      if (!response.ok) {
        return res.status(502).json({ success: false, code: 'PROVIDER_ERROR', message: 'The video provider is temporarily unavailable.' });
      }
      const payload = await response.json();
      if (payload?.code !== 0 || !payload?.data) {
        return res.status(422).json({ success: false, code: 'VIDEO_UNAVAILABLE', message: payload?.msg || 'The video could not be resolved. It may be private, deleted, or unsupported.' });
      }

      const d = payload.data;
      const author = d.author || {};
      const noWatermark = d.hdplay || d.play || null;
      return res.json({
        success: true,
        source: 'TikWM',
        result: {
          id: d.id || null,
          title: d.title || null,
          author: {
            id: author.id || null,
            username: author.unique_id || null,
            nickname: author.nickname || null,
            avatar: author.avatar || null
          },
          duration: d.duration ?? null,
          cover: d.cover || null,
          dimensions: { width: d.width ?? null, height: d.height ?? null },
          statistics: {
            views: d.play_count ?? null,
            likes: d.digg_count ?? null,
            comments: d.comment_count ?? null,
            shares: d.share_count ?? null
          },
          downloads: {
            video_no_watermark: noWatermark,
            video_watermarked: d.wmplay || null,
            audio: d.music || null
          },
          note: 'Download links are temporary and may expire. Only download content you own or have permission to use.'
        }
      });
    } catch (error) {
      const timeoutError = error?.name === 'AbortError';
      return res.status(timeoutError ? 504 : 502).json({
        success: false,
        code: timeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILURE',
        message: timeoutError ? 'The provider took too long to respond.' : 'Could not process this video right now.'
      });
    } finally {
      clearTimeout(timeout);
    }
  }
};
