const { resolveMedia } = require('./lib/ytdlp');
module.exports = {
 name:'TikTok Downloader', path:'/api/v1/downloader/tiktok', method:'GET', category:'Downloader', plan:'Both',
 description:'Mengambil metadata dan URL video TikTok publik. Parameter q berisi URL TikTok.',
 async execute(req,res){ const q=typeof req.query.q==='string'?req.query.q.trim():''; if(!q)return res.status(400).json({success:false,code:'QUERY_REQUIRED',message:'Masukkan URL TikTok melalui parameter q.'}); try{return res.json({success:true,platform:'tiktok',result:await resolveMedia(q,'tiktok')});}catch(e){return res.status(e.status||502).json({success:false,code:e.code||'PROVIDER_ERROR',message:e.message||'TikTok downloader gagal.'});} }
};
