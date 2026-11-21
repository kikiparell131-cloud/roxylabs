/**
 * RoxyLabs - Pinterest Search
 *
 * Endpoint:
 * GET /api/v1/pinterest/search?q=elaina&limit=5&type=image
 *
 * Parameters:
 * q     : Search keyword
 * limit : Number of results (1-30)
 * type  : all | image | video
 *
 * Returns:
 * Pinterest search results with image/video previews,
 * pin URLs, and media URLs.
 *
 * Note:
 * Pinterest public HTML is not a stable API.
 * Results depend on publicly available Pinterest data.
 */

const https = require('node:https');

const PINTEREST_URL = 'https://www.pinterest.com';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

const IMAGE_EXTENSIONS = /\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i;

/**
 * Decode common HTML and JSON escapes.
 */
function decodeText(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003A/gi, ':')
    .replace(/\\u0022/gi, '"')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, '/');
}

/**
 * Clean text extracted from Pinterest HTML.
 */
function cleanText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return decodeText(value)
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

/**
 * Normalize Pinterest image URLs.
 *
 * Important:
 * Pinterest HTML can contain CSS or other text after an image URL.
 * This function stops at the actual image extension.
 */
function normalizeImageUrl(rawUrl) {
  try {
    let url = decodeText(rawUrl)
      .replace(/\\/g, '')
      .trim();

    // Remove accidental punctuation around the URL.
    url = url.replace(/^[("'`]+/, '');

    // Find the real image extension.
    const extensionMatch = url.match(
      /\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'<>\\\s]*)?/i
    );

    if (!extensionMatch) {
      return null;
    }

    // Cut off anything after the image URL.
    url = url.slice(
      0,
      extensionMatch.index + extensionMatch[0].length
    );

    // Remove trailing punctuation.
    url = url.replace(/[),;]+$/, '');

    const parsed = new URL(url);

    // Only accept Pinterest CDN media.
    if (
      parsed.hostname !== 'i.pinimg.com' &&
      !parsed.hostname.endsWith('.pinimg.com')
    ) {
      return null;
    }

    // Verify that the pathname is an image.
    if (!IMAGE_EXTENSIONS.test(parsed.pathname)) {
      return null;
    }

    parsed.hash = '';

    // Prefer a consistent preview size.
    parsed.pathname = parsed.pathname.replace(
      /^\/(?:originals|736x|564x|474x|236x|170x)\//,
      '/564x/'
    );

    return parsed.toString();

  } catch {
    return null;
  }
}

/**
 * Extract a Pinterest pin ID from a text fragment.
 */
function extractPinId(text) {
  const patterns = [
    /"pin_id"\s*:\s*"?(\\?\d{8,})"?/i,
    /"pinId"\s*:\s*"?(\\?\d{8,})"?/i,
    /"id"\s*:\s*"?(\\?\d{8,})"?/i,
    /\/pin\/(\d{8,})\/?/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) {
      continue;
    }

    const id = match[1].replace(/\\/g, '');

    if (/^\d{8,}$/.test(id)) {
      return id;
    }
  }

  return null;
}

/**
 * Extract a title from nearby Pinterest data.
 */
function extractTitle(text, fallback) {
  const patterns = [
    /"grid_title"\s*:\s*"((?:\\.|[^"\\])*)"/i,
    /"title"\s*:\s*"((?:\\.|[^"\\])*)"/i,
    /"description"\s*:\s*"((?:\\.|[^"\\])*)"/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) {
      continue;
    }

    const title = cleanText(match[1]);

    if (title && title.length > 1) {
      return title.slice(0, 220);
    }
  }

  return fallback;
}

/**
 * Detect video references.
 */
function detectVideo(text) {
  return (
    /"videos"\s*:/i.test(text) ||
    /"video"\s*:/i.test(text) ||
    /\.mp4(?:\?|["\\])/i.test(text)
  );
}

/**
 * Extract all usable Pinterest images from HTML.
 *
 * Unlike the previous parser, this function:
 * - Stops image URLs at the real extension.
 * - Removes invalid CSS suffixes.
 * - Deduplicates image URLs.
 * - Collects multiple image candidates.
 */
function extractImageCandidates(html, query) {
  const text = decodeText(html);

  const results = [];
  const seen = new Set();

  const imageRegex =
    /https?:\\?\/\\?\/i\.pinimg\.com\/[^\s"'<>\\]+/gi;

  let match;

  while ((match = imageRegex.exec(text)) !== null) {
    const image = normalizeImageUrl(match[0]);

    if (!image) {
      continue;
    }

    if (seen.has(image)) {
      continue;
    }

    seen.add(image);

    // Read nearby data for title and pin ID.
    const start = Math.max(0, match.index - 3000);

    const end = Math.min(
      text.length,
      match.index + match[0].length + 3000
    );

    const nearby = text.slice(start, end);

    const pinId = extractPinId(nearby);

    const title = extractTitle(
      nearby,
      query || 'Pinterest Image'
    );

    const isVideo = detectVideo(nearby);

    results.push({
      title,

      image,

      pin_url: pinId
        ? `${PINTEREST_URL}/pin/${pinId}/`
        : null,

      media_type: isVideo
        ? 'video'
        : 'image',

      pin_id: pinId
    });
  }

  return results;
}

/**
 * Remove duplicate pins.
 *
 * Prefer pin ID when available.
 * Otherwise use the normalized image URL.
 */
function deduplicateResults(results) {
  const unique = new Map();

  for (const item of results) {
    const key = item.pin_id || item.image;

    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return Array.from(unique.values());
}

/**
 * Request Pinterest search page.
 */
async function fetchPinterestSearch(query, signal) {
  const target = new URL(
    '/search/pins/',
    PINTEREST_URL
  );

  target.searchParams.set('q', query);

  const response = await fetch(target.toString(), {
    method: 'GET',

    redirect: 'follow',

    signal,

    headers: {
      'user-agent': USER_AGENT,

      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

      'accept-language': 'en-US,en;q=0.9',

      'cache-control': 'no-cache'
    }
  });

  return response;
}

module.exports = {
  name: 'Pinterest Search',

  path: '/api/v1/pinterest/search',

  method: 'GET',

  category: 'Search',

  plan: 'Both',

  description:
    'Search public Pinterest pins by keyword with image/video previews and direct pin links.',

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

    // Validate keyword.
    if (!query) {
      return res.status(400).json({
        success: false,

        code: 'QUERY_REQUIRED',

        message:
          'Provide a search keyword using q.',

        api: 'roxylabs'
      });
    }

    if (query.length > 100) {
      return res.status(400).json({
        success: false,

        code: 'QUERY_TOO_LONG',

        message:
          'Search keyword must be 100 characters or fewer.',

        api: 'roxylabs'
      });
    }

    // Validate media type.
    if (!['all', 'image', 'video'].includes(type)) {
      return res.status(400).json({
        success: false,

        code: 'INVALID_TYPE',

        message:
          'type must be all, image, or video.',

        api: 'roxylabs'
      });
    }

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      20000
    );

    try {
      const response = await fetchPinterestSearch(
        query,
        controller.signal
      );

      // Handle provider errors.
      if (!response.ok) {
        return res.status(502).json({
          success: false,

          code: 'PROVIDER_ERROR',

          message:
            `Pinterest returned HTTP ${response.status}.`,

          api: 'roxylabs'
        });
      }

      const html = await response.text();

      if (!html || html.length < 100) {
        return res.status(502).json({
          success: false,

          code: 'EMPTY_PROVIDER_RESPONSE',

          message:
            'Pinterest returned an empty response.',

          api: 'roxylabs'
        });
      }

      // Extract all image candidates first.
      const candidates = extractImageCandidates(
        html,
        query
      );

      // Filter media type.
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

      // Remove duplicates.
      const uniqueResults = deduplicateResults(
        filtered
      );

      // Apply requested limit.
      const results = uniqueResults.slice(0, limit);

      // No results.
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

      // Successful response.
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
        timedOut
          ? 'Request timed out.'
          : error
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