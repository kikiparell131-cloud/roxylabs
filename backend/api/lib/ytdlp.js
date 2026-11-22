const { spawn } = require('child_process');
const HOSTS = {
  youtube: ['youtube.com','youtu.be','youtube-nocookie.com'],
  tiktok: ['tiktok.com','vm.tiktok.com','vt.tiktok.com'],
  twitter: ['x.com','twitter.com','t.co'],
  threads: ['threads.net','threads.com'],
  facebook: ['facebook.com','fb.watch','fb.com'],
  instagram: ['instagram.com','instagr.am'],
  soundcloud: ['soundcloud.com'],
  bilibili: ['bilibili.com','b23.tv'],
  terabox: ['terabox.com','1024tera.com','teraboxapp.com'],
  gdrive: ['drive.google.com','docs.google.com'],
  pinterest: ['pinterest.com','pin.it'],
  reddit: ['reddit.com','redd.it','v.redd.it'],
  dailymotion: ['dailymotion.com','dai.ly'],
  vimeo: ['vimeo.com'],
  twitch: ['twitch.tv'],
  likee: ['likee.video','likee.com'],
  snapchat: ['snapchat.com'],
  tumblr: ['tumblr.com'],
  sfile: ['sfile.mobi'],
};
function validUrl(input, platform) {
  let u; try { u = new URL(input); } catch { throw Object.assign(new Error('Parameter q harus berupa URL yang valid.'), { status: 400, code: 'INVALID_URL' }); }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = HOSTS[platform] || [];
  if (u.protocol !== 'https:' || !allowed.some(d => host === d || host.endsWith('.' + d))) {
    throw Object.assign(new Error(`URL bukan berasal dari ${platform}.`), { status: 400, code: 'INVALID_PLATFORM' });
  }
  return u.toString();
}
function run(args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.YTDLP_BIN || 'yt-dlp', args, { stdio: ['ignore','pipe','pipe'] });
    let out = '', err = '', finished = false;
    const timer = setTimeout(() => { finished = true; child.kill('SIGKILL'); reject(Object.assign(new Error('Provider timeout.'), { code: 'PROVIDER_TIMEOUT', status: 504 })); }, timeout);
    child.stdout.on('data', b => { out += b; if (out.length > 5_000_000) child.kill('SIGKILL'); });
    child.stderr.on('data', b => { err += b; if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', e => { clearTimeout(timer); reject(Object.assign(new Error('yt-dlp belum tersedia di server. Pasang yt-dlp terlebih dahulu.'), { code: 'YTDLP_NOT_INSTALLED', status: 503 })); });
    child.on('close', code => { if (finished) return; clearTimeout(timer); if (code !== 0) return reject(Object.assign(new Error(err.trim().split('\n').slice(-2).join(' ') || 'Media tidak dapat diproses.'), { code: 'MEDIA_UNAVAILABLE', status: 422 })); resolve(out.trim()); });
  });
}
async function resolveMedia(input, platform) {
  const url = validUrl(input, platform);
  const raw = await run(['--dump-single-json','--no-warnings','--no-playlist','--skip-download','--no-check-certificates',url]);
  let d; try { d = JSON.parse(raw); } catch { throw Object.assign(new Error('Provider mengembalikan metadata yang tidak valid.'), { status: 502, code: 'BAD_PROVIDER_RESPONSE' }); }
  const formats = (d.formats || []).filter(f => f.url && (f.vcodec !== 'none' || f.acodec !== 'none')).slice(-20).map(f => ({ formatId:f.format_id || null, ext:f.ext || null, quality:f.format_note || f.resolution || null, width:f.width || null, height:f.height || null, filesize:f.filesize || f.filesize_approx || null, audioOnly:f.vcodec === 'none', videoOnly:f.acodec === 'none', url:f.url }));
  let directUrl = d.url || null;
  if (!directUrl && formats.length) directUrl = formats[formats.length - 1].url;
  return { platform, id:d.id || null, title:d.title || null, description:d.description || null, uploader:d.uploader || d.channel || null, uploaderUrl:d.uploader_url || null, duration:d.duration || null, thumbnail:d.thumbnail || (d.thumbnails || []).slice(-1)[0]?.url || null, webpageUrl:d.webpage_url || url, viewCount:d.view_count ?? null, likeCount:d.like_count ?? null, uploadDate:d.upload_date || null, directUrl, formats, note:'URL media dari provider dapat kedaluwarsa. Gunakan hanya konten yang Anda miliki atau diizinkan untuk diunduh.' };
}
module.exports = { resolveMedia, validUrl, run };
