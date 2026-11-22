/**
 * Pinterest public pin resolver. Extracts public image/video media URLs from
 * Pinterest's page metadata. Only use content you own or have permission to use.
 */
module.exports = {
  name: 'Pinterest Downloader',
  path: '/api/v1/downloader/pinterest',
  method: 'GET',
  category: 'Downloader',
  plan: 'Both',
  description: 'Resolve a public Pinterest pin into available image/video media URLs and metadata.',
  async execute(req, res) {
    const input = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ success: false, code: 'URL_REQUIRED', message: 'Masukkan URL Pinterest melalui parameter q.' });
    }
    let url;
    try { url = new URL(input.trim()); } catch {
      return res.status(400).json({ success: false, code: 'INVALID_URL', message: 'The URL is not valid.' });
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(host === 'pinterest.com' || host.endsWith('.pinterest.com') || host === 'pin.it')) {
      return res.status(400).json({ success: false, code: 'PINTEREST_URL_REQUIRED', message: 'Only HTTPS Pinterest pin URLs are accepted.' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const page = await fetch(url.toString(), {
        redirect: 'follow', signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; RoxyLabs/1.0)', accept: 'text/html' }
      });
      if (!page.ok) return res.status(502).json({ success: false, code: 'PROVIDER_ERROR', message: 'Pinterest could not be reached for this pin.' });
      const html = await page.text();
      const meta = (name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
        const match = html.match(re);
        return match ? decode(match[1] || match[2] || '') : null;
      };
      const decode = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
      const title = meta('og:title');
      const image = meta('og:image') || meta('twitter:image');
      const video = meta('og:video:secure_url') || meta('og:video') || meta('twitter:player:stream');
      const media = [];
      if (video) media.push({ type: 'video', url: video });
      if (image) media.push({ type: 'image', url: image });
      if (!media.length) return res.status(422).json({ success: false, code: 'MEDIA_NOT_FOUND', message: 'No public image or video media was found in this pin page.' });
      return res.json({ success: true, source: 'Pinterest page metadata', result: { title, media, note: 'Media URLs may expire or be restricted. Use only content you own or have permission to download.' } });
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      return res.status(timedOut ? 504 : 502).json({ success: false, code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILURE', message: timedOut ? 'Pinterest took too long to respond.' : 'Could not process this pin right now.' });
    } finally { clearTimeout(timeout); }
  }
};
