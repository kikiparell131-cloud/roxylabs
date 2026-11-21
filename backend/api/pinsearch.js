/**
 * ============================================================
 * ROXYLABS - PINTEREST SEARCH
 * ============================================================
 *
 * Endpoint:
 *
 * GET /api/v1/pinterest/search?q=elaina&limit=5&type=image
 *
 * Parameters:
 *
 * q     : Search keyword
 * limit : Number of results (1-10)
 * type  : all | image | video
 *
 * ============================================================
 */

'use strict';

const axios = require('axios');
const https = require('https');

/**
 * HTTPS agent.
 */
const agent = new https.Agent({
  rejectUnauthorized: true,
  maxVersion: 'TLSv1.3',
  minVersion: 'TLSv1.2',
  keepAlive: true
});

/**
 * Pinterest configuration.
 */
const PINTEREST_URL = 'https://www.pinterest.com';

const SEARCH_URL =
  `${PINTEREST_URL}/resource/BaseSearchResource/get/`;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0';

/**
 * ============================================================
 * GET PINTEREST COOKIES
 * ============================================================
 */

async function getCookies() {
  try {
    const response = await axios.get(
      `${PINTEREST_URL}/csrf_error/`,
      {
        httpsAgent: agent,
        timeout: 20000,

        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml'
        },

        validateStatus: () => true
      }
    );

    const setCookieHeaders =
      response.headers['set-cookie'];

    if (
      !Array.isArray(setCookieHeaders) ||
      !setCookieHeaders.length
    ) {
      return null;
    }

    const cookies = setCookieHeaders
      .map(cookie => cookie.split(';')[0].trim())
      .filter(Boolean);

    return cookies.length
      ? cookies.join('; ')
      : null;

  } catch (error) {
    console.error(
      '[PINTEREST] Cookie error:',
      error.message
    );

    return null;
  }
}

/**
 * ============================================================
 * NORMALIZE IMAGE URL
 * ============================================================
 */

function normalizeImageUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    return null;
  }

  try {
    let url = rawUrl
      .replace(/\\u002F/gi, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&')
      .trim();

    const parsed = new URL(url);

    /**
     * Only accept Pinterest CDN URLs.
     */
    if (
      parsed.hostname !== 'i.pinimg.com' &&
      !parsed.hostname.endsWith('.pinimg.com')
    ) {
      return null;
    }

    /**
     * Reject URLs containing invalid extensions.
     */
    if (
      !/\.(jpg|jpeg|png|webp|gif)$/i.test(
        parsed.pathname
      )
    ) {
      return null;
    }

    parsed.hash = '';

    /**
     * Prefer a consistent preview size.
     */
    parsed.pathname = parsed.pathname.replace(
      /^\/(originals|736x|564x|474x|236x|170x)\//,
      '/564x/'
    );

    return parsed.toString();

  } catch {
    return null;
  }
}

/**
 * ============================================================
 * EXTRACT PINTEREST RESULT
 * ============================================================
 */

function extractPin(result, query) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  /**
   * Get image URL.
   */
  const rawImage =
    result.images?.orig?.url ||
    result.images?.['564x']?.url ||
    result.images?.['474x']?.url ||
    result.images?.['236x']?.url ||
    result.image_large_url ||
    result.image_medium_url ||
    result.image_small_url ||
    null;

  const image = normalizeImageUrl(rawImage);

  if (!image) {
    return null;
  }

  /**
   * Get pin ID.
   */
  const pinId = String(
    result.id ||
    result.pin_id ||
    ''
  ).trim();

  /**
   * Get title.
   */
  const title =
    result.grid_title ||
    result.title ||
    result.description ||
    query;

  /**
   * Get Pinterest user information.
   */
  const pinner = result.pinner || {};

  const username =
    pinner.username ||
    '-';

  const fullname =
    pinner.full_name ||
    username ||
    '-';

  const followers =
    Number(pinner.follower_count) || 0;

  /**
   * Detect video.
   */
  const videos = result.videos || {};

  const hasVideo =
    Boolean(
      videos.video_list ||
      videos.video ||
      videos.video_url ||
      result.story_pin_data ||
      result.media_type === 'video'
    );

  const videoUrl =
    videos.video_list?.V_720P?.url ||
    videos.video_list?.V_480P?.url ||
    videos.video_list?.V_HLSV3_MOBILE?.url ||
    videos.video?.url ||
    videos.video_url ||
    null;

  const mediaType = hasVideo
    ? 'video'
    : 'image';

  /**
   * Return normalized data.
   */
  return {
    pin_id: pinId || null,

    title: String(title).slice(0, 220),

    image,

    video: videoUrl,

    media_type: mediaType,

    pin_url: pinId
      ? `${PINTEREST_URL}/pin/${pinId}/`
      : null,

    upload_by: username,

    fullname,

    followers,

    source: pinId
      ? `${PINTEREST_URL}/pin/${pinId}/`
      : null
  };
}

/**
 * ============================================================
 * PINTEREST SEARCH
 * ============================================================
 */

async function pinterestSearch(query, limit, type) {
  /**
   * Get cookies first.
   */
  const cookies = await getCookies();

  if (!cookies) {
    throw new Error(
      'Pinterest did not provide the required cookies.'
    );
  }

  /**
   * Search parameters.
   *
   * Request more candidates than the requested limit
   * because some results may not contain usable images.
   */
  const requestedResults = Math.min(
    Math.max(limit * 4, 25),
    100
  );

  const params = {
    source_url:
      `/search/pins/?q=${encodeURIComponent(query)}`,

    data: JSON.stringify({
      options: {
        isPrefetch: false,

        query,

        scope: 'pins',

        no_fetch_context_on_resource: false,

        page_size: requestedResults
      },

      context: {}
    }),

    _: Date.now()
  };

  /**
   * Pinterest request headers.
   */
  const headers = {
    accept:
      'application/json, text/javascript, */*, q=0.01',

    'accept-language':
      'en-US,en;q=0.9',

    cookie: cookies,

    referer:
      `${PINTEREST_URL}/search/pins/?q=${encodeURIComponent(query)}`,

    'user-agent': USER_AGENT,

    'x-requested-with':
      'XMLHttpRequest',

    'x-pinterest-appstate':
      'active',

    'x-pinterest-source-url':
      '/search/pins/',

    'x-pinterest-pws-handler':
      'www/[username]/[slug].js'
  };

  /**
   * Execute search request.
   */
  const response = await axios.get(
    SEARCH_URL,
    {
      httpsAgent: agent,

      headers,

      params,

      timeout: 30000,

      validateStatus: () => true
    }
  );

  /**
   * Handle provider errors.
   */
  if (response.status !== 200) {
    const error = new Error(
      `Pinterest returned HTTP ${response.status}.`
    );

    error.status = response.status;

    throw error;
  }

  /**
   * Extract results.
   */
  const rawResults =
    response.data?.resource_response?.data?.results;

  if (!Array.isArray(rawResults)) {
    throw new Error(
      'Pinterest returned an unexpected response format.'
    );
  }

  /**
   * Normalize and remove duplicate pins.
   */
  const results = [];

  const seen = new Set();

  for (const raw of rawResults) {
    const item = extractPin(raw, query);

    if (!item) {
      continue;
    }

    const key =
      item.pin_id ||
      item.image;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    results.push(item);
  }

  /**
   * Apply media type filter.
   */
  let filtered = results;

  if (type === 'image') {
    filtered = results.filter(
      item => item.media_type === 'image'
    );
  }

  if (type === 'video') {
    filtered = results.filter(
      item => item.media_type === 'video'
    );
  }

  /**
   * Return results.
   */
  return filtered.slice(0, limit);
}

/**
 * ============================================================
 * API MODULE
 * ============================================================
 */

module.exports = {
  name: 'Pinterest Search',

  path: '/api/v1/pinterest/search',

  method: 'GET',

  category: 'Search',

  plan: 'Both',

  description:
    'Search Pinterest pins by keyword with image and video previews.',

  async execute(req, res) {
    /**
     * Get query.
     */
    const query =
      typeof req.query.q === 'string'
        ? req.query.q.trim()
        : '';

    /**
     * Get limit.
     */
    const limitRaw = Number.parseInt(
      String(req.query.limit || '10'),
      10
    );

    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(limitRaw, 10))
      : 10;

    /**
     * Get media type.
     */
    const type =
      typeof req.query.type === 'string'
        ? req.query.type.toLowerCase()
        : 'all';

    /**
     * Validate query.
     */
    if (!query) {
      return res.status(400).json({
        success: false,

        code: 'QUERY_REQUIRED',

        message:
          'Provide a search keyword using q.'
      });
    }

    if (query.length > 100) {
      return res.status(400).json({
        success: false,

        code: 'QUERY_TOO_LONG',

        message:
          'Search keyword must be 100 characters or fewer.'
      });
    }

    /**
     * Validate type.
     */
    if (!['all', 'image', 'video'].includes(type)) {
      return res.status(400).json({
        success: false,

        code: 'INVALID_TYPE',

        message:
          'type must be all, image, or video.'
      });
    }

    try {
      /**
       * Execute Pinterest search.
       */
      const results = await pinterestSearch(
        query,
        limit,
        type
      );

      /**
       * No results.
       */
      if (!results.length) {
        return res.status(422).json({
          success: false,

          code: 'NO_RESULTS',

          message:
            'No usable Pinterest results were found.',

          query,

          requested: limit,

          returned: 0,

          type
        });
      }

      /**
       * Successful response.
       *
       * The main RoxyLabs backend automatically
       * adds api: roxylabs to every JSON response.
       */
      return res.json({
        success: true,

        source: 'Pinterest Search',

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
          : {})
      });

    } catch (error) {
      console.error(
        '[PINTEREST SEARCH]',
        error?.response?.data ||
        error?.message ||
        error
      );

      const status =
        error.status === 429 ? 429 : 502;

      return res.status(status).json({
        success: false,

        code:
          status === 429
            ? 'PROVIDER_RATE_LIMITED'
            : 'PROVIDER_ERROR',

        message:
          status === 429
            ? 'Pinterest is temporarily rate-limiting requests.'
            : 'Pinterest search could not be completed.'
      });
    }
  }
};