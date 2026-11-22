const { resolveMedia } = require('./lib/ytdlp');
module.exports = {
  name: 'Likee Downloader', path: '/api/v1/downloader/likee', method: 'GET', category: 'Downloader', plan: 'Both',
  description: 'Mengambil metadata dan URL media dari Likee. Parameter q berisi URL publik.',
  async execute(req, res) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.status(400).json({ success:false, code:'QUERY_REQUIRED', message:'Masukkan URL melalui parameter q.' });
    try { const result = await resolveMedia(q, 'likee'); return res.json({ success:true, platform:'likee', result }); }
    catch (error) { return res.status(error.status || 502).json({ success:false, code:error.code || 'PROVIDER_ERROR', message:error.message || 'Downloader gagal diproses.' }); }
  }
};
