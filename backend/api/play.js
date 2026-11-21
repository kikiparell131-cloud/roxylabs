/** YouTube music/video search. Returns metadata and official YouTube watch URLs as JSON. */
const yts = require('yt-search');

module.exports = {
  name: 'YouTube Play Search',
  path: '/api/v1/youtube/play',
  method: 'GET',
  category: 'Search',
  plan: 'Both',
  description: 'Search YouTube for songs and return video metadata and watch URLs as JSON.',
  async execute(req, res) {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rawLimit = Number.parseInt(String(req.query.limit || '5'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(10, rawLimit)) : 5;

    if (!query) return res.status(400).json({ success: false, code: 'QUERY_REQUIRED', message: 'Provide a song title or artist using q.' });
    if (query.length > 100) return res.status(400).json({ success: false, code: 'QUERY_TOO_LONG', message: 'Search query must be 100 characters or fewer.' });

    try {
      const result = await yts(query);
      const videos = (result.videos || []).slice(0, limit).map(video => ({
        title: video.title,
        videoId: video.videoId,
        url: video.url,
        duration: video.timestamp || null,
        durationSeconds: video.seconds || 0,
        views: Number(video.views || 0),
        author: video.author?.name || null,
        thumbnail: video.thumbnail || null,
        uploaded: video.ago || null
      }));
      return res.json({ success: true, source: 'YouTube search', query, requested: limit, returned: videos.length, result: videos });
    } catch (error) {
      console.error('YouTube play search failed:', error);
      return res.status(502).json({ success: false, code: 'YOUTUBE_SEARCH_FAILED', message: 'YouTube search is temporarily unavailable.' });
    }
  }
};
