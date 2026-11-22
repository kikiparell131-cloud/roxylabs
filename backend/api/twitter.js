const axios = require('axios');
const cheerio = require('cheerio');

function assertUrl(value) {
  let u; try { u = new URL(value); } catch { throw Object.assign(new Error('Parameter q harus berupa URL valid.'), { status: 400, code: 'INVALID_URL' }); }
  if (u.protocol !== 'https:' || !['x.com','twitter.com','t.co'].some(h => u.hostname === h || u.hostname.endsWith('.' + h))) {
    throw Object.assign(new Error('URL harus berasal dari X/Twitter.'), { status: 400, code: 'INVALID_PLATFORM' });
  }
  return u.href;
}
async function scrapeTwitter(url) {
  const body = new URLSearchParams({ q: url, lang: 'id', cftoken: '' });
  const { data } = await axios.post('https://savetwitter.net/api/ajaxSearch', body, {
    timeout: 30000,
    headers: { 'User-Agent':'Mozilla/5.0', 'Content-Type':'application/x-www-form-urlencoded', 'X-Requested-With':'XMLHttpRequest', Origin:'https://savetwitter.net', Referer:'https://savetwitter.net/id3' }
  });
  const html = data?.data;
  if (!html || typeof html !== 'string') throw new Error('Provider tidak mengembalikan data video.');
  const $ = cheerio.load(html);
  const title = $('h3').first().text().trim() || 'Twitter Video';
  const duration = $('p').filter((_, el) => /^\d+:\d+$/.test($(el).text().trim())).first().text().trim() || null;
  const thumbnail = $('img').first().attr('src') || null;
  const formats = [...html.matchAll(/href="(https:\/\/dl\.snapcdn\.app\/get\?token=[^"]+)".*?MP4\s*\(([^)]+)\)/gs)]
    .map(m => ({ quality: m[2].trim(), url: m[1].replace(/&amp;/g,'&') }));
  if (!formats.length) throw new Error('Video tidak ditemukan atau postingan tidak menyediakan video publik.');
  return { title, duration, thumbnail, formats };
}
module.exports = {
  name:'Twitter/X Downloader', path:'/api/v1/downloader/twitter', method:'GET', category:'Downloader', plan:'Both',
  description:'Konversi scraper SaveTwitter dari modul bot menjadi JSON. Parameter q berisi URL X/Twitter.',
  async execute(req,res) {
    const q=String(req.query.q||'').trim();
    if(!q)return res.status(400).json({success:false,code:'QUERY_REQUIRED',message:'Masukkan URL melalui parameter q.'});
    try { const url=assertUrl(q); const result=await scrapeTwitter(url); return res.json({success:true,platform:'twitter',result}); }
    catch(e){return res.status(e.status||502).json({success:false,code:e.code||'PROVIDER_ERROR',message:e.message||'Twitter downloader gagal.'});}
  }
};
