const cheerio = require('cheerio');
const axios = require('axios');
module.exports = {
 name:'MediaFire Downloader', path:'/api/v1/downloader/mediafire', method:'GET', category:'Downloader', plan:'Both',
 description:'Mengambil metadata file dan tautan unduhan publik MediaFire. Parameter q berisi URL file.',
 async execute(req,res){
  const q=typeof req.query.q==='string'?req.query.q.trim():'';
  if(!q)return res.status(400).json({success:false,code:'QUERY_REQUIRED',message:'Masukkan URL MediaFire melalui parameter q.'});
  let u;try{u=new URL(q)}catch{return res.status(400).json({success:false,code:'INVALID_URL',message:'URL tidak valid.'})}
  if(u.protocol!=='https:'||!/(^|\.)mediafire\.com$/i.test(u.hostname))return res.status(400).json({success:false,code:'INVALID_PLATFORM',message:'URL harus berasal dari MediaFire.'});
  try{
   const page=await axios.get(u.toString(),{timeout:25000,headers:{'user-agent':'Mozilla/5.0'}});
   const $=cheerio.load(page.data);const download=$('a#downloadButton').attr('href');
   if(!download)return res.status(404).json({success:false,code:'FILE_NOT_FOUND',message:'Tautan unduhan tidak ditemukan atau file tidak publik.'});
   const match=u.pathname.match(/\/file\/([a-z0-9]+)/i);
   let info={};
   if(match){const r=await axios.get('https://www.mediafire.com/api/1.5/file/get_info.php',{params:{response_format:'json',quick_key:match[1]},timeout:20000});if(r.data?.response?.result==='Success')info=r.data.response.file_info||{}}
   return res.json({success:true,platform:'mediafire',result:{filename:info.filename||$('meta[property="og:title"]').attr('content')||null,size:info.size?Number(info.size):null,filetype:info.filetype||null,mimetype:info.mimetype||null,downloadUrl:download}});
  }catch(e){return res.status(502).json({success:false,code:'PROVIDER_ERROR',message:'Gagal mengambil data MediaFire.'})}
 }
};
