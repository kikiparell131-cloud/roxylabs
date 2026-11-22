const axios = require('axios');
const FormData = require('form-data');
const cheerio = require('cheerio');

async function instagramDownload(url) {
  const form = new FormData(); form.append('url', url); form.append('action', 'post');
  const response = await axios.post('https://snapinsta.top/action.php', form, {
    headers: { ...form.getHeaders(), 'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36', accept: '*/*', origin: 'https://snapinsta.top', referer: 'https://snapinsta.top/' }, timeout: 30000
  });
  const $ = cheerio.load(response.data); const downloads = [];
  $('.download-items__btn a').each((_, el) => {
    let href = $(el).attr('href'); if (!href) return;
    if (!href.startsWith('http')) href = new URL(href, 'https://snapinsta.top').href;
    downloads.push(href);
  });
  return [...new Set(downloads)];
}

module.exports = {
  name: 'Instagram Downloader', path: '/api/v1/downloader/instagram', method: 'GET', category: 'Downloader', plan: 'Both',
  description: 'Mengambil tautan media dari postingan, reel, atau video Instagram publik. Parameter: q (URL Instagram).',
  async execute(req, res) {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, code: 'MISSING_QUERY', message: 'Gunakan parameter q berisi URL Instagram.' });
    let parsed; try { parsed = new URL(q); } catch { return res.status(400).json({ success: false, code: 'INVALID_URL', message: 'URL tidak valid.' }); }
    if (!/(^|\.)instagram\.com$/.test(parsed.hostname)) return res.status(400).json({ success: false, code: 'INVALID_PLATFORM', message: 'URL harus berasal dari Instagram.' });
    try {
      const result = await instagramDownload(q);
      if (!result.length) return res.status(404).json({ success: false, code: 'MEDIA_NOT_FOUND', message: 'Media tidak ditemukan atau akun/postingan bersifat privat.' });
      return res.json({ success: true, platform: 'instagram', total: result.length, result: result.map((url, index) => ({ index: index + 1, url })) });
    } catch (error) { return res.status(502).json({ success: false, code: 'PROVIDER_ERROR', message: error.message || 'Instagram downloader gagal.' }); }
  }
};
