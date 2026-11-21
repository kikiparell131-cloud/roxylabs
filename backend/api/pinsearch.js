/**
 * Pinterest public search adapter. Results are extracted from publicly served
 * Pinterest search HTML; Pinterest may rate-limit or change its markup.
 * Only use media you own or have permission to use.
 */
module.exports = {
  name: 'Pinterest Search',
  path: '/api/v1/pinterest/search',
  method: 'GET',
  category: 'Search',
  plan: 'Both',
  description: 'Search public Pinterest pins by keyword, with image/video previews and direct pin links.',
  async execute(req, res) {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limitRaw = Number.parseInt(String(req.query.limit || '10'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(30, limitRaw)) : 10;
    const type = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : 'all';
    if (!query) return res.status(400).json({ success: false, code: 'QUERY_REQUIRED', message: 'Provide a search keyword using q.' });
    if (query.length > 100) return res.status(400).json({ success: false, code: 'QUERY_TOO_LONG', message: 'Search keyword must be 100 characters or fewer.' });
    if (!['all', 'image', 'video'].includes(type)) return res.status(400).json({ success: false, code: 'INVALID_TYPE', message: 'type must be all, image, or video.' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const target = new URL('https://www.pinterest.com/search/pins/');
      target.searchParams.set('q', query);
      const response = await fetch(target.toString(), {
        redirect: 'follow', signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml'
        }
      });
      if (!response.ok) return res.status(502).json({ success: false, code: 'PROVIDER_ERROR', message: `Pinterest returned HTTP ${response.status}.` });
      const html = await response.text();
      const decode = (s) => s.replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/').replace(/\\"/g, '"');
      const text = decode(html);
      const results = [];
      const seen = new Set();
      // Pinterest embeds pin URLs and pinimg media URLs in its search payload.
      const imageRe = /https?:\\?\/\\?\/i\.pinimg\.com\/(?:originals|736x|564x|474x|236x|170x)\/[^\s"'<>\\]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>\\]*)?/gi;
      let match;
      while ((match = imageRe.exec(text)) && results.length < limit * 4) {
        const image = match[0].replace(/\\u003[dD]/g, '=').replace(/\\u0026/g, '&').replace(/\\/g, '');
        if (seen.has(image)) continue;
        seen.add(image);
        const start = Math.max(0, match.index - 1800);
        const end = Math.min(text.length, match.index + match[0].length + 1800);
        const nearby = text.slice(start, end);
        const pinMatch = nearby.match(/https?:\\?\/\\?\/(?:www\.)?pinterest\.com\/pin\/\d+\/?/i);
        const pinUrl = pinMatch ? pinMatch[0].replace(/\\/g, '') : null;
        const titleMatch = nearby.match(/(?:\"title\"\s*:\s*\"|<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"'])([^\"'<>]{2,220})/i);
        const title = titleMatch ? titleMatch[1].replace(/\\u[0-9a-f]{4}/gi, '').replace(/\\n/g, ' ').trim() : query;
        const isVideo = /\"videos\"|\"video\"|\.mp4/i.test(nearby);
        if (type === 'video' && !isVideo) continue;
        results.push({ title, image, pin_url: pinUrl, media_type: isVideo ? 'video' : 'image' });
        if (results.length >= limit) break;
      }
      if (!results.length) return res.status(422).json({ success: false, code: 'NO_RESULTS', message: 'No public results could be extracted. Pinterest may have blocked the request or changed its page format.' });
      return res.json({ success: true, source: 'Pinterest public search', query, limit, type, total: results.length, result: results, note: 'Search results depend on Pinterest public page availability. Image URLs may expire; open pin_url for the original pin.' });
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      return res.status(timedOut ? 504 : 502).json({ success: false, code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILURE', message: timedOut ? 'Pinterest search timed out.' : 'Pinterest search could not be completed.' });
    } finally { clearTimeout(timeout); }
  }
};
