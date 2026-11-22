const axios = require('axios');

async function getToken() {
  const { data: html } = await axios.get('https://fbdownloader.to/id', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7' }, timeout: 20000
  });
  const match = html.match(/k_exp="(.*?)".*?k_token="(.*?)"/s);
  if (!match) throw new Error('Token provider Facebook tidak ditemukan');
  return { k_exp: match[1], k_token: match[2] };
}

async function facebookDownload(url) {
  const { k_exp, k_token } = await getToken();
  const payload = new URLSearchParams({ k_exp, k_token, p: 'home', q: url, lang: 'id', v: 'v2', W: '' });
  const { data } = await axios.post('https://fbdownloader.to/api/ajaxSearch', payload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://fbdownloader.to', Referer: 'https://fbdownloader.to/id' }, timeout: 30000
  });
  if (!data?.data) throw new Error('Provider tidak mengembalikan data video');
  const results = [];
  const regex = /<td class="video-quality">(.*?)<\/td>[\s\S]*?(?:href="(.*?)"|data-videourl="(.*?)")/g;
  let match;
  while ((match = regex.exec(data.data)) !== null) {
    const quality = match[1].replace(/<[^>]*>/g, '').trim();
    const download = match[2] || match[3];
    if (quality && download) results.push({ quality, url: download });
  }
  if (!results.length) throw new Error('Tidak ada tautan video. Pastikan postingan bersifat publik.');
  return results;
}

module.exports = {
  name: 'Facebook Downloader', path: '/api/v1/downloader/facebook', method: 'GET', category: 'Downloader', plan: 'Both',
  description: 'Mengambil pilihan kualitas video dari tautan Facebook publik. Parameter: q (URL Facebook).',
  async execute(req, res) {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, code: 'MISSING_QUERY', message: 'Gunakan parameter q berisi URL Facebook.' });
    let parsed; try { parsed = new URL(q); } catch { return res.status(400).json({ success: false, code: 'INVALID_URL', message: 'URL tidak valid.' }); }
    if (!/(^|\.)facebook\.com$|(^|\.)fb\.watch$/.test(parsed.hostname)) return res.status(400).json({ success: false, code: 'INVALID_PLATFORM', message: 'URL harus berasal dari Facebook.' });
    try { const result = await facebookDownload(q); return res.json({ success: true, platform: 'facebook', result }); }
    catch (error) { return res.status(502).json({ success: false, code: 'PROVIDER_ERROR', message: error.message || 'Facebook downloader gagal.' }); }
  }
};
