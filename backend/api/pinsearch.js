/**
 * RoxyLabs - Pinterest Search
 *
 * Search public Pinterest pins by keyword.
 * Supports image/video filtering and configurable result limits.
 *
 * Note:
 * Pinterest public HTML is not a stable API.
 * Results depend on the data Pinterest makes available.
 */

const PINTEREST_URL = 'https://www.pinterest.com';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

function decodeHtml(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003A/gi, ':')
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, '/');
}

function cleanString(value) {
  if (typeof value !== 'string') return '';

  return value
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImageUrl(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.hostname !== 'i.pinimg.com' &&
      !parsed.hostname.endsWith('.pinimg.com')
    ) {
      return null;
    }

    parsed.hash = '';

    // Use a consistent preview size.
    parsed.pathname = parsed.pathname.replace(
      /^\/(?:originals|736x|564x|474x|236x|170x)\//,
      '/564x/'
    );

    return parsed.toString();
  } catch {
    return null;
  }
}

function extractPinId(text) {
  const patterns = [
    /"pin_id"\s*:\s*"?(\\?\d{8,})"?/i,
    /"pinId"\s*:\s*"?(\\?\d{8,})"?/i,
    /"id"\s*:\s*"?(\\?\d{8,})"?/i,
    /\/pin\/(\d{8,})\/?/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const id = match[1].replace(/\\/g, '');

      if (/^\d{8,}$/.test(id)) {
        return id;
      }
    }
  }

  return null;
}

function extractTitle(text, fallback) {
  const patterns = [
    /"grid_title"\s*:\s*"((?:\\.|[^"\\])*)"/i,
    /"title"\s*:\s*"((?:\\.|[^"\\])*)"/i,
    /"description"\s*:\s*"((?:\\.|[^"\\])*)"/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const title = cleanString(match[1]);

      if (title && title.length > 1) {
        return title.slice(0, 220);
      }
    }
  }

  return fallback;
}

function extractImageCandidates(text) {
  const results = [];
  const seen = new Set();

  // Match Pinterest CDN URLs, including escaped JSON URLs.
  const imageRegex =
    /https?:\\?\/\\?\/i\.pinimg\.com\/[^\s"'<>\\]+/gi;

  let match;

  while ((match = imageRegex.exec(text)) !== null) {
    let rawUrl = match[0]
      .replace(/\\u003[dD]/g, '=')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\/g, '');

    rawUrl = rawUrl.replace(/[),;]+$/, '');

    // Remove common JSON escaping.
    rawUrl = rawUrl.replace(/&amp;/gi, '&');

    const image = normalizeImageUrl(rawUrl);

    if (!image || seen.has(image)) continue;

    seen.add(image);

    // Read nearby data for title and pin ID.
    const start = Math.max(0, match.index - 12000);
    const end = Math.min(
      text.length,
      match.index + match[0].length + 12000
    );

    const nearby = text.slice(start, end);

    const pinId = extractPinId(nearby);

    const title = extractTitle(
      nearby,
      'Pinterest Image'
    );

    const isVideo =
      /"videos"\s*:/i.test(nearby) ||
      /"video"\s*:/i.test(nearby) ||
      /\.mp4(?:\?|["\\])/i.test(nearby);

    results.push({
      title,
      image,
      pin_url: pinId
        ? `${PINTEREST_URL}/pin/${pinId}/`
        : null,
      media_type: isVideo ? 'video' : 'image',
      pin_id: pinId
    });
  }

  return results;
}

module.exports = {
  name: 'Pinterest Search',

  path: '/api/v1/pinterest/search',

  method: 'GET',

  category: 'Search',

  plan: 'Free',

  description:
    'Search public Pinterest pins by keyword with image/video previews.',

  async execute(req, res) {
    const query =
      typeof req.query.q === 'string'
        ? req.query.q.trim()
        : '';

    const limitRaw = Number.parseInt(
      String(req.query.limit || '10'),
      10
    );

    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(30, limitRaw))
      : 10;

    const type =
      typeof req.query.type === 'string'
        ? req.query.type.toLowerCase()
        : 'all';

    if (!query) {
      return res.status(400).json({
        success: false,
        code: 'QUERY_REQUIRED',
        message: 'Provide a search keyword using q.'
      });
    }

    if (query.length > 100) {
      return res.status(400).json({
        success: false,
        code: 'QUERY_TOO_LONG',
        message: 'Search keyword must be 100 characters or fewer.'
      });
    }

    if (!['all', 'image', 'video'].includes(type)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TYPE',
        message: 'type must be all, image, or video.'
      });
    }

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      20000
    );

    try {
      const target = new URL(
        '/search/pins/',
        PINTEREST_URL
      );

      target.searchParams.set('q', query);

      const response = await fetch(target.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,

        headers: {
          'user-agent': USER_AGENT,

          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

          'accept-language': 'en-US,en;q=0.9',

          'cache-control': 'no-cache'
        }
      });

      if (!response.ok) {
        return res.status(502).json({
          success: false,
          code: 'PROVIDER_ERROR',
          message: `Pinterest returned HTTP ${response.status}.`
        });
      }

      const html = await response.text();

      if (!html || html.length < 100) {
        return res.status(502).json({
          success: false,
          code: 'EMPTY_PROVIDER_RESPONSE',
          message: 'Pinterest returned an empty response.'
        });
      }

      const text = decodeHtml(html);

      const candidates = extractImageCandidates(text);

      // Filter by requested media type.
      let filtered = candidates;

      if (type === 'image') {
        filtered = candidates.filter(
          item => item.media_type === 'image'
        );
      }

      if (type === 'video') {
        filtered = candidates.filter(
          item => item.media_type === 'video'
        );
      }

      // Avoid returning multiple sizes of the same pin.
      const uniquePins = new Map();

      for (const item of filtered) {
        const key = item.pin_id || item.image;

        if (!uniquePins.has(key)) {
          uniquePins.set(key, item);
        }
      }

      const results = Array.from(
        uniquePins.values()
      ).slice(0, limit);

      if (!results.length) {
        return res.status(422).json({
          success: false,
          code: 'NO_RESULTS',

          message:
            'No usable Pinterest results were found. ' +
            'Pinterest may have blocked the request or changed its page format.',

          query,
          requested: limit,
          type,
          api: 'roxylabs'
        });
      }

      return res.json({
        success: true,

        source: 'Pinterest public search',

        query,

        requested: limit,

        returned: results.length,

        limit,

        type,

        total: results.length,

        result: results,

        ...(results.length < limit
          ? {
              warning:
                `Only ${results.length} usable result(s) were found ` +
                `for the ${limit} requested.`
            }
          : {}),

        note:
          'Image URLs may expire. Open pin_url to view the original pin.'
      });

    } catch (error) {
      const timedOut =
        error && error.name === 'AbortError';

      console.error(
        '[PinSearch]',
        timedOut ? 'Request timed out.' : error
      );

      return res.status(timedOut ? 504 : 502).json({
        success: false,

        code: timedOut
          ? 'PROVIDER_TIMEOUT'
          : 'PROVIDER_FAILURE',

        message: timedOut
          ? 'Pinterest search timed out.'
          : 'Pinterest search could not be completed.',

        api: 'roxylabs'
      });

    } finally {
      clearTimeout(timeout);
    }
  }
};