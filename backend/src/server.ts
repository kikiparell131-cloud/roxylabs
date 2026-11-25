import 'dotenv/config';
import express,{Request,Response} from 'express';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {createHash,randomBytes} from 'node:crypto';
import {authenticateApiKey} from './middleware/apiKey';
import {enforceQuota,writeUsage} from './middleware/usage';
type RegisteredEndpoint={name:string;path:string;method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';category:string;plan:'Free'|'Premium'|'Both';description:string;handler:(req:Request,res:Response)=>unknown|Promise<unknown>;moduleFile:string};
declare const require:(id:string)=>any;
function loadJavaScriptModules():RegisteredEndpoint[]{
 const dir=path.resolve(process.cwd(),'api');
 try{return readdirSync(dir).filter(file=>file.endsWith('.js')&&!file.startsWith('.')).map(file=>{
  const loaded=require(path.join(dir,file));
  const mod=loaded.default||loaded;
  if(!mod.name||!/^\/api\/v1\/[a-z0-9/_-]+$/.test(mod.path||'')||!['GET','POST','PUT','PATCH','DELETE'].includes(mod.method)||typeof mod.execute!=='function')throw new Error(`Invalid API module: ${file}`);
  return {...mod,handler:mod.execute,moduleFile:file} as RegisteredEndpoint;
 });}catch(error:any){if(error?.code==='ENOENT')return [];throw error;}
}
// Files in backend/api are only candidates. An owner must register each one in Admin before it becomes public.
const availableModules=loadJavaScriptModules();
if(new Set(availableModules.map(x=>x.path)).size!==availableModules.length)throw new Error('Two backend/api modules cannot share the same API path.');
const activeModules=new Map<string,{endpoint:RegisteredEndpoint;config:any}>();
import {supabase} from './lib/supabase';
import {requireSession,requireAdmin} from './middleware/session';

const app=express();
// Stamp every JSON API response with the required service identity.
app.use((_req,res,next)=>{
 const originalJson=res.json.bind(res);
 res.json=(body:any)=>originalJson(body&&typeof body==='object'&&!Array.isArray(body)?{...body,api:'roxylabs'}:{api:'roxylabs',result:body});
 next();
});
app.set('trust proxy',1);
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));

const allowedOrigins=(process.env.CORS_ORIGINS||'http://localhost:3000')
 .split(',').map(x=>x.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
 origin(origin,callback){
  // Allow server-to-server/health checks and explicitly configured browser origins.
  if(!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin.replace(/\/$/, ''))){
   return callback(null,true);
  }
  // Vercel preview deployments can be enabled explicitly with *.vercel.app.
  if(allowedOrigins.includes('*.vercel.app') && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)){
   return callback(null,true);
  }
  return callback(new Error(`CORS_ORIGIN_DENIED: ${origin}`));
 },
 credentials:true,
 methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
 allowedHeaders:['Content-Type','Authorization','x-api-key']
}));
app.use(express.json({limit:'1mb'}));

app.get('/',(_req,res)=>res.json({
 success:true,
 name:'Roxy Main API',
 version:'1.0.0',
 message:'Roxy backend is running.',
 endpoints:{
  health:'/health',
  documentation:'/api/v1/endpoints',
  dashboard:'/dashboard/overview'
 },
 note:'This is an API backend. Open the Vercel frontend URL for the website.'
}));
const limiter=rateLimit({windowMs:60_000,limit:30,standardHeaders:true,legacyHeaders:false,message:{success:false,code:'RATE_LIMITED',message:'Too many requests. Try again shortly.'}});
app.get('/health',async(_req,res)=>{
 let database:'connected'|'not_configured'|'error'=supabase?'error':'not_configured';
 let databaseError:string|undefined;
 if(supabase){
  const {error}=await supabase.from('profiles').select('id').limit(1);
  database=error?'error':'connected';
  if(error)databaseError=error.message;
 }
 res.status(database==='error'?503:200).json({
  success:database!=='error',service:'Roxy Main API',version:'1.0.0',
  backend:'online',database, ...(databaseError?{databaseError}:{}),
  time:new Date().toISOString()
 });
});

async function syncDiscoveredModules(){
 if(!supabase)return;
 // Every trusted module deployed in backend/api is automatically published on startup.
 // Existing rows are preserved so owner-edited names, categories, plans and disabled state remain intact.
 for(const mod of availableModules){
  const {data:existing,error:lookupError}=await supabase.from('api_endpoints').select('id').eq('path',mod.path).maybeSingle();
  if(lookupError){console.error(`Could not check endpoint ${mod.path}:`,lookupError.message);continue;}
  if(existing)continue;
  const {error}=await supabase.from('api_endpoints').insert({
   name:mod.name,path:mod.path,method:mod.method,category:mod.category||'Tools',
   plan:mod.plan||'Both',description:mod.description||'',handler:mod.moduleFile,is_active:true
  });
  if(error)console.error(`Could not auto-register ${mod.moduleFile}:`,error.message);
  else console.log(`Auto-registered API module: ${mod.method} ${mod.path}`);
 }
}
async function refreshActiveModules(){
 activeModules.clear();
 if(!supabase)return;
 const {data,error}=await supabase.from('api_endpoints').select('*').eq('is_active',true);
 if(error){console.error('Could not load registered endpoint metadata:',error.message);return;}
 for(const config of data||[]){
  const mod=availableModules.find(x=>x.moduleFile===config.handler);
  if(!mod||mod.path!==config.path||mod.method!==config.method){
   console.warn(`Endpoint ${config.name} is inactive at runtime: missing or mismatched backend/api/${config.handler}`);
   continue;
  }
  activeModules.set(`${config.method}:${config.path}`,{endpoint:mod,config});
 }
}
app.get('/api/v1/endpoints',async(_req,res)=>{
 if(!supabase)return res.status(503).json({success:false,code:'DATABASE_NOT_CONFIGURED'});
 const {data,error}=await supabase.from('api_endpoints').select('id,name,path,method,category,plan,description,handler,is_active,created_at').eq('is_active',true).order('created_at',{ascending:false});
 if(error)return res.status(503).json({success:false,code:'ENDPOINT_REGISTRY_UNAVAILABLE',message:error.message});
 const result=(data||[]).filter(row=>activeModules.has(`${row.method}:${row.path}`)).map(row=>({...row,source:'code'}));
 res.json({success:true,result});
});

// User workspace APIs
app.get('/dashboard/overview',requireSession,async(req,res)=>{
 if(!supabase)return res.status(503).json({success:false,code:'DATABASE_NOT_CONFIGURED'});
 const id=req.sessionUser!.id;const now=new Date();
 const usageDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const today=new Date(`${usageDay}T00:00:00+07:00`);const month=new Date(`${usageDay.slice(0,7)}-01T00:00:00+07:00`);
 const results=await Promise.all([
  supabase.from('api_logs').select('status_code,created_at,response_time_ms').eq('user_id',id).gte('created_at',today.toISOString()),
  supabase.from('api_logs').select('id',{count:'exact',head:true}).eq('user_id',id).gte('created_at',month.toISOString()),
  supabase.from('api_logs').select('created_at,status_code').eq('user_id',id).gte('created_at',new Date(Date.now()-6*86400000).toISOString()),
  supabase.from('api_keys').select('id').eq('user_id',id).eq('is_active',true),
  supabase.from('profiles').select('plan,role,custom_daily_limit,premium_expires_at').eq('id',id).maybeSingle(),
  supabase.from('api_usage_daily').select('request_count').eq('user_id',id).eq('usage_date',usageDay).maybeSingle()
 ]);
 const queryError=results.find(x=>x.error)?.error;
 if(queryError){
  console.error('dashboard overview query failed:',queryError);
  return res.status(503).json({success:false,code:'DASHBOARD_QUERY_FAILED',error:queryError.message});
 }
 const [{data:todayLogs},{count:monthCount},{data:weekLogs},{data:keys},{data:profile},{data:usage}]=results;
 if(!profile)return res.status(404).json({success:false,code:'PROFILE_NOT_FOUND',message:'No profile row exists for this account. Run the Supabase schema trigger or create the profile row.'});
 const rows=todayLogs||[];const owner=profile.role==='owner';const limit=owner?0:(profile.custom_daily_limit||(profile.plan==='premium'?1000:200));
 const success=rows.filter(x=>x.status_code<400).length;
 const days=Array.from({length:7},(_,i)=>{const d=new Date(Date.now()-(6-i)*86400000);const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);return {date,count:(weekLogs||[]).filter(x=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x.created_at))===date).length};});
 res.json({success:true,result:{requestsToday:rows.length,requestsMonth:monthCount||0,remainingQuota:owner?null:Math.max(0,limit-(usage?.request_count||0)),dailyLimit:owner?null:limit,successRate:rows.length?Number((success/rows.length*100).toFixed(1)):0,activeKeys:keys?.length||0,plan:profile?.plan||'free',role:profile?.role||'free',activity:days}});
});
app.get('/dashboard/logs',requireSession,async(req,res)=>{
 const limit=Math.min(Math.max(Number(req.query.limit)||30,1),100);
 const {data,error}=await supabase!.from('api_logs').select('id,endpoint,method,status_code,response_time_ms,created_at').eq('user_id',req.sessionUser!.id).order('created_at',{ascending:false}).limit(limit);
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});
app.get('/dashboard/keys',requireSession,async(req,res)=>{
 const {data,error}=await supabase!.from('api_keys').select('id,key_prefix,is_active,created_at,last_used_at').eq('user_id',req.sessionUser!.id).order('created_at',{ascending:false});
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});
app.post('/dashboard/keys',requireSession,async(req,res)=>{
 const {count:activeKeyCount}=await supabase!.from('api_keys').select('id',{count:'exact',head:true}).eq('user_id',req.sessionUser!.id).eq('is_active',true);
 if((activeKeyCount||0)>=1)return res.status(409).json({success:false,code:'ACTIVE_KEY_LIMIT',message:'Your plan allows one active API key. Revoke the current key first.'});
 const raw='roxy_live_'+randomBytes(28).toString('base64url');const hash=createHash('sha256').update(raw).digest('hex');
 const {data,error}=await supabase!.from('api_keys').insert({user_id:req.sessionUser!.id,key_hash:hash,key_prefix:raw.slice(0,16),is_active:true}).select('id,key_prefix,created_at').single();
 if(error)return res.status(400).json({success:false,error:error.message});
 res.status(201).json({success:true,result:{...data,apiKey:raw},warning:'Copy this key now. It cannot be displayed again.'});
});
app.delete('/dashboard/keys/:id',requireSession,async(req,res)=>{
 const {error}=await supabase!.from('api_keys').update({is_active:false}).eq('id',req.params.id).eq('user_id',req.sessionUser!.id);
 if(error)return res.status(400).json({success:false,error:error.message});res.json({success:true});
});
app.get('/dashboard/profile',requireSession,async(req,res)=>{
 const {data,error}=await supabase!.from('profiles').select('id,username,plan,role,status,premium_expires_at,custom_daily_limit,created_at').eq('id',req.sessionUser!.id).single();
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:{...data,email:req.sessionUser!.email}});
});

// Admin workspace
app.use('/admin',requireSession,requireAdmin);
app.get('/admin/overview',async(_req,res)=>{
 const [users,premium,logs,errors]=await Promise.all([
  supabase!.from('profiles').select('id',{count:'exact',head:true}),
  supabase!.from('profiles').select('id',{count:'exact',head:true}).eq('role','premium'),
  supabase!.from('api_logs').select('id',{count:'exact',head:true}).gte('created_at',new Date(new Date().setHours(0,0,0,0)).toISOString()),
  supabase!.from('api_logs').select('id',{count:'exact',head:true}).gte('created_at',new Date(Date.now()-86400000).toISOString()).gte('status_code',400)
 ]);
 res.json({success:true,result:{users:users.count||0,premium:premium.count||0,requestsToday:logs.count||0,errorsToday:errors.count||0}});
});
app.get('/admin/users',async(req,res)=>{
 const q=String(req.query.q||'');let query=supabase!.from('profiles').select('id,username,plan,role,status,premium_expires_at,created_at').order('created_at',{ascending:false}).limit(100);
 if(q)query=query.ilike('username',`%${q}%`);
 const {data,error}=await query;if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});
app.patch('/admin/users/:id/premium',async(req,res)=>{
 const {active,expiresAt}=req.body||{};if(typeof active!=='boolean')return res.status(400).json({success:false,error:'active must be boolean'});
 const {data:target}=await supabase!.from('profiles').select('role').eq('id',req.params.id).maybeSingle();
 if(!target)return res.status(404).json({success:false,code:'USER_NOT_FOUND'});
 if(target.role==='owner')return res.status(403).json({success:false,code:'OWNER_ROLE_PROTECTED',message:'Owner role cannot be changed from Premium management.'});
 const {error}=await supabase!.from('profiles').update({plan:active?'premium':'free',role:active?'premium':'free',premium_expires_at:active?(expiresAt||null):null}).eq('id',req.params.id);
 if(error)return res.status(400).json({success:false,error:error.message});
 await supabase!.from('admin_audit_logs').insert({admin_id:req.sessionUser!.id,target_user_id:req.params.id,action:active?'premium_granted':'premium_revoked',metadata:{expiresAt:expiresAt||null}});
 res.json({success:true});
});
app.get('/admin/logs',async(req,res)=>{
 const limit=Math.min(Number(req.query.limit)||100,500);
 const {data,error}=await supabase!.from('api_logs').select('*').order('created_at',{ascending:false}).limit(limit);
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});
app.get('/admin/modules',async(_req,res)=>{
 const {data:registered,error}=await supabase!.from('api_endpoints').select('handler,is_active');
 if(error)return res.status(500).json({success:false,error:error.message});
 const registeredFiles=new Set((registered||[]).map(x=>x.handler));
 res.json({success:true,result:availableModules.map(({handler,...mod})=>({...mod,registered:registeredFiles.has(mod.moduleFile)}))});
});
app.get('/admin/endpoints',async(_req,res)=>{
 const {data,error}=await supabase!.from('api_endpoints').select('*').order('created_at',{ascending:false});
 if(error)return res.status(500).json({success:false,error:error.message});
 const result=(data||[]).map(row=>({...row,source:availableModules.some(m=>m.moduleFile===row.handler&&m.path===row.path&&m.method===row.method)?'code':'missing-module'}));
 res.json({success:true,result});
});
app.post('/admin/endpoints',async(req,res)=>{
 const {handler,plan,is_active=true,category,name}=req.body||{};
 const mod=availableModules.find(x=>x.moduleFile===handler);
 if(!mod)return res.status(400).json({success:false,code:'MODULE_NOT_FOUND',message:'Choose a JavaScript module that exists in backend/api on Railway.'});
 if(!['Free','Premium','Both'].includes(plan))return res.status(400).json({success:false,error:'Access plan must be Free, Premium or Both.'});
 const {count}=await supabase!.from('api_endpoints').select('id',{count:'exact',head:true}).eq('handler',handler);
 if((count||0)>0)return res.status(409).json({success:false,code:'MODULE_ALREADY_REGISTERED',message:'This backend module has already been registered.'});
 const cleanCategory=typeof category==='string'&&category.trim()?category.trim().slice(0,40):mod.category;
 const cleanName=typeof name==='string'&&name.trim()?name.trim().slice(0,60):mod.name;
 const payload={name:cleanName,path:mod.path,method:mod.method,category:cleanCategory,plan,description:mod.description||'',handler:mod.moduleFile,is_active:!!is_active};
 const {data,error}=await supabase!.from('api_endpoints').insert(payload).select().single();
 if(error)return res.status(400).json({success:false,error:error.message});
 if(data.is_active)activeModules.set(`${mod.method}:${mod.path}`,{endpoint:mod,config:data});
 await supabase!.from('admin_audit_logs').insert({admin_id:req.sessionUser!.id,action:'endpoint_registered',metadata:{endpoint_id:data.id,module:handler,path:mod.path}});
 res.status(201).json({success:true,result:data,message:'Backend module registered and live. It is now available in API Docs.'});
});
app.patch('/admin/endpoints/:id',async(req,res)=>{
 const allowed=['plan','is_active','description','category','name'];const patch=Object.fromEntries(Object.entries(req.body||{}).filter(([k])=>allowed.includes(k)));
 const {data,error}=await supabase!.from('api_endpoints').update(patch).eq('id',req.params.id).select().single();
 if(error)return res.status(400).json({success:false,error:error.message});
 const mod=availableModules.find(x=>x.moduleFile===data.handler&&x.path===data.path&&x.method===data.method);
 const key=`${data.method}:${data.path}`;
 if(data.is_active&&mod)activeModules.set(key,{endpoint:mod,config:data});else activeModules.delete(key);
 res.json({success:true,result:data});
});
app.delete('/admin/endpoints/:id',async(req,res)=>{
 const {data}=await supabase!.from('api_endpoints').select('method,path').eq('id',req.params.id).maybeSingle();
 const {error}=await supabase!.from('api_endpoints').delete().eq('id',req.params.id);
 if(error)return res.status(400).json({success:false,error:error.message});
 if(data)activeModules.delete(`${data.method}:${data.path}`);
 res.json({success:true});
});

app.get('/admin/audit',async(_req,res)=>{
 const {data,error}=await supabase!.from('admin_audit_logs').select('*').order('created_at',{ascending:false}).limit(100);
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});

// Only trusted modules committed to backend/api and synchronized into the owner's endpoint registry are executable.
// Public temporary audio proxy. Vercel rewrites /roxy/play/:filename to this
// backend route; the signed Supabase URL is kept server-side and never exposed.
app.get('/roxy/play/:filename', limiter, async (req, res) => {
 const filename=String(req.params.filename||'');
 if(!/^[a-z0-9][a-z0-9-]{0,100}-[a-f0-9]{10}\.mp3$/i.test(filename))
  return res.status(400).json({success:false,code:'INVALID_FILENAME'});
 if(!supabase)return res.status(503).json({success:false,code:'STORAGE_NOT_CONFIGURED'});
 const bucket=process.env.ROXY_PLAY_BUCKET||'roxy-play';
 const {data:row,error}=await supabase.from('roxy_play_files')
  .select('storage_path,filename,title,expires_at').eq('filename',filename).maybeSingle();
 if(error)return res.status(503).json({success:false,code:'PLAY_LOOKUP_FAILED'});
 if(!row)return res.status(404).json({success:false,code:'PLAY_FILE_NOT_FOUND'});
 if(new Date(row.expires_at).getTime()<=Date.now())return res.status(410).json({success:false,code:'PLAY_FILE_EXPIRED'});
 const {data:signed,error:signedError}=await supabase.storage.from(bucket)
  .createSignedUrl(row.storage_path,90,{download:filename});
 if(signedError||!signed?.signedUrl)return res.status(502).json({success:false,code:'PLAY_SIGNED_URL_FAILED'});
 try{
  const upstream=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(30_000)});
  if(!upstream.ok||!upstream.body)return res.status(502).json({success:false,code:'PLAY_STORAGE_FETCH_FAILED'});
  res.status(200);
  res.setHeader('Content-Type','audio/mpeg');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  const length=upstream.headers.get('content-length');
  if(length)res.setHeader('Content-Length',length);
  const reader=upstream.body.getReader();
  try{
   while(true){
    const {done,value}=await reader.read();
    if(done)break;
    if(!res.write(Buffer.from(value)))await new Promise(resolve=>res.once('drain',resolve));
   }
   res.end();
  }catch(streamError){res.destroy(streamError);}
 }catch(error:any){
  if(!res.headersSent)return res.status(504).json({success:false,code:'PLAY_STREAM_TIMEOUT'});
  res.destroy(error);
 }
});

app.all('/api/v1/*',limiter,(req,res,next)=>{
  if(!activeModules.has(`${req.method}:${req.path}`))return res.status(404).json({success:false,code:'ENDPOINT_NOT_REGISTERED',message:'This endpoint has not been registered by the owner.'});
  next();
},authenticateApiKey,enforceQuota,async(req:Request,res:Response)=>{
 const entry=activeModules.get(`${req.method}:${req.path}`)!;
 const started=Date.now();const {endpoint,config}=entry;
 try{
  if(config.plan==='Premium'&&req.apiUser?.role!=='owner'&&req.apiUser?.plan!=='premium'){
   res.status(403);
   return res.json({success:false,code:'PREMIUM_REQUIRED',message:'This endpoint requires a Premium subscription.'});
  }
  await endpoint.handler(req,res);
 }catch(err){console.error('endpoint failure',endpoint.path,err);if(!res.headersSent)res.status(500).json({success:false,code:'INTERNAL_ERROR'});}
 finally{await writeUsage(req,res,started,endpoint.path).catch(e=>console.error('log write failed',e));}
});

app.use((err:any,_req:Request,res:Response,_next:any)=>{
 console.error('request error:',err);
 if(err?.message?.startsWith('CORS_ORIGIN_DENIED:')){
  return res.status(403).json({success:false,code:'CORS_ORIGIN_DENIED',message:'Add this frontend domain to Railway CORS_ORIGINS.',origin:err.message.split(': ').slice(1).join(': ')});
 }
 return res.status(500).json({success:false,code:'INTERNAL_SERVER_ERROR'});
});

const port=Number(process.env.PORT||4000);
void syncDiscoveredModules().then(refreshActiveModules).finally(()=>app.listen(port,'0.0.0.0',()=>console.log(`Roxy Main API listening on 0.0.0.0:${port}; ${activeModules.size} endpoint module(s) active.`)));
