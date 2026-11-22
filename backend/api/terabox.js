const { resolveMedia } = require('./lib/ytdlp');
module.exports = {
  name: 'TeraBox Downloader', path: '/api/v1/downloader/terabox', method: 'GET', category: 'Downloader', plan: 'Both',
  description: 'Mengambil metadata dan URL media dari TeraBox. Parameter q berisi URL publik.',
  async execute(req, res) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.status(400).json({ success:false, code:'QUERY_REQUIRED', message:'Masukkan URL melalui parameter q.' });
    try { const result = await resolveMedia(q, 'terabox'); return res.json({ success:true, platform:'terabox', result }); }
    catch (error) { return res.status(error.status || 502).json({ success:false, code:error.code || 'PROVIDER_ERROR', message:error.message || 'Downloader gagal diproses.' }); }
  }
};
