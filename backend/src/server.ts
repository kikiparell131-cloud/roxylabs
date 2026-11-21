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
import {registry,RegisteredEndpoint} from './modules/registry';
declare const require:(id:string)=>any;
function loadJavaScriptModules():RegisteredEndpoint[]{
 const dir=path.resolve(process.cwd(),'api');
 try{return readdirSync(dir).filter(file=>file.endsWith('.js')).map(file=>{
  const loaded=require(path.join(dir,file));
  const mod=loaded.default||loaded;
  if(!mod.name||!mod.path||!['GET','POST','PUT','PATCH','DELETE'].includes(mod.method)||typeof mod.execute!=='function')throw new Error(`Invalid API module: ${file}`);
  return {...mod,handler:mod.execute} as RegisteredEndpoint;
 });}catch(error:any){if(error?.code==='ENOENT')return [];throw error;}
}
const allModules=[...registry,...loadJavaScriptModules()];
if(new Set(allModules.map(x=>x.path)).size!==allModules.length)throw new Error('Duplicate API module path detected.');
import {supabase} from './lib/supabase';
import {requireSession,requireAdmin} from './middleware/session';

const app=express();app.set('trust proxy',1);app.use(helmet());
app.use(cors({origin:(process.env.CORS_ORIGINS||'http://localhost:3000').split(',').map(x=>x.trim()),credentials:true}));
app.use(express.json({limit:'1mb'}));
const limiter=rateLimit({windowMs:60_000,limit:30,standardHeaders:true,legacyHeaders:false,message:{success:false,code:'RATE_LIMITED',message:'Too many requests. Try again shortly.'}});
app.get('/health',(_req,res)=>res.json({success:true,service:'Roxy Main API',version:'1.0.0',time:new Date().toISOString()}));

app.get('/api/v1/endpoints',async(_req,res)=>{
 const base=allModules.map(({handler,...meta})=>({...meta,source:'code'}));
 const {data}=supabase?await supabase.from('api_endpoints').select('id,name,path,method,category,plan,description,handler,is_active').eq('is_active',true):{data:[]};
 const known=new Set(base.map(x=>x.path));
 res.json({success:true,result:[...base,...(data||[]).filter(x=>!known.has(x.path)).map(x=>({...x,source:'metadata'}))]});
});

for(const ep of allModules){
 const method=ep.method.toLowerCase() as 'get'|'post'|'put'|'patch'|'delete';
 (app as any)[method](ep.path,limiter,authenticateApiKey,enforceQuota,async(req:Request,res:Response)=>{
   const started=Date.now();
   if(ep.plan==='Premium'&&req.apiUser?.plan!=='premium'){
     res.status(403);await writeUsage(req,res,started,ep.path);
     return res.json({success:false,code:'PREMIUM_REQUIRED',message:'This endpoint requires a Premium subscription.'});
   }
   try{await ep.handler(req,res)}catch(err){console.error('endpoint failure',ep.path,err);if(!res.headersSent)res.status(500).json({success:false,code:'INTERNAL_ERROR'});}
   finally{await writeUsage(req,res,started,ep.path).catch(e=>console.error('log write failed',e));}
 });
}

// User workspace APIs
app.get('/dashboard/overview',requireSession,async(req,res)=>{
 if(!supabase)return res.status(503).json({success:false,code:'DATABASE_NOT_CONFIGURED'});
 const id=req.sessionUser!.id;const now=new Date();
 const usageDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const today=new Date(`${usageDay}T00:00:00+07:00`);const month=new Date(`${usageDay.slice(0,7)}-01T00:00:00+07:00`);
 const [{data:todayLogs},{count:monthCount},{data:weekLogs},{data:keys},{data:profile},{data:usage}] = await Promise.all([
  supabase.from('api_logs').select('status_code,created_at,response_time_ms').eq('user_id',id).gte('created_at',today.toISOString()),
  supabase.from('api_logs').select('id',{count:'exact',head:true}).eq('user_id',id).gte('created_at',month.toISOString()),
  supabase.from('api_logs').select('created_at,status_code').eq('user_id',id).gte('created_at',new Date(Date.now()-6*86400000).toISOString()),
  supabase.from('api_keys').select('id').eq('user_id',id).eq('is_active',true),
  supabase.from('profiles').select('plan,custom_daily_limit,premium_expires_at').eq('id',id).single(),
  supabase.from('api_usage_daily').select('request_count').eq('user_id',id).eq('usage_date',usageDay).maybeSingle()
 ]);
 const rows=todayLogs||[];const limit=profile?.custom_daily_limit||(profile?.plan==='premium'?1000:200);
 const success=rows.filter(x=>x.status_code<400).length;
 const days=Array.from({length:7},(_,i)=>{const d=new Date(Date.now()-(6-i)*86400000);const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);return {date,count:(weekLogs||[]).filter(x=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x.created_at))===date).length};});
 res.json({success:true,result:{requestsToday:rows.length,requestsMonth:monthCount||0,remainingQuota:Math.max(0,limit-(usage?.request_count||0)),dailyLimit:limit,successRate:rows.length?Number((success/rows.length*100).toFixed(1)):0,activeKeys:keys?.length||0,plan:profile?.plan||'free',activity:days}});
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
 const {data,error}=await supabase!.from('profiles').select('id,username,plan,status,premium_expires_at,custom_daily_limit,created_at').eq('id',req.sessionUser!.id).single();
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:{...data,email:req.sessionUser!.email}});
});

// Admin workspace
app.use('/admin',requireSession,requireAdmin);
app.get('/admin/overview',async(_req,res)=>{
 const [users,premium,logs,errors]=await Promise.all([
  supabase!.from('profiles').select('id',{count:'exact',head:true}),
  supabase!.from('profiles').select('id',{count:'exact',head:true}).eq('plan','premium'),
  supabase!.from('api_logs').select('id',{count:'exact',head:true}).gte('created_at',new Date(new Date().setHours(0,0,0,0)).toISOString()),
  supabase!.from('api_logs').select('id',{count:'exact',head:true}).gte('created_at',new Date(Date.now()-86400000).toISOString()).gte('status_code',400)
 ]);
 res.json({success:true,result:{users:users.count||0,premium:premium.count||0,requestsToday:logs.count||0,errorsToday:errors.count||0}});
});
app.get('/admin/users',async(req,res)=>{
 const q=String(req.query.q||'');let query=supabase!.from('profiles').select('id,username,plan,status,premium_expires_at,created_at').order('created_at',{ascending:false}).limit(100);
 if(q)query=query.ilike('username',`%${q}%`);
 const {data,error}=await query;if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});
app.patch('/admin/users/:id/premium',async(req,res)=>{
 const {active,expiresAt}=req.body||{};if(typeof active!=='boolean')return res.status(400).json({success:false,error:'active must be boolean'});
 const {error}=await supabase!.from('profiles').update({plan:active?'premium':'free',premium_expires_at:active?(expiresAt||null):null}).eq('id',req.params.id);
 if(error)return res.status(400).json({success:false,error:error.message});
 await supabase!.from('admin_audit_logs').insert({admin_id:req.sessionUser!.id,target_user_id:req.params.id,action:active?'premium_granted':'premium_revoked',metadata:{expiresAt:expiresAt||null}});
 res.json({success:true});
});
app.get('/admin/logs',async(req,res)=>{
 const limit=Math.min(Number(req.query.limit)||100,500);
 const {data,error}=await supabase!.from('api_logs').select('*').order('created_at',{ascending:false}).limit(limit);
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});
app.get('/admin/endpoints',async(_req,res)=>{
 const {data,error}=await supabase!.from('api_endpoints').select('*').order('created_at',{ascending:false});
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:[...allModules.map(({handler,...x})=>({...x,source:'code',is_active:true})),...(data||[])]});
});
app.post('/admin/endpoints',async(req,res)=>{
 const {name,path,method,category,plan,description,handler,is_active=true}=req.body||{};
 if(!name||!/^\/api\/v1\/[a-z0-9/_-]+$/.test(path||'')||!['GET','POST','PUT','PATCH','DELETE'].includes(method)||!category||!['Free','Premium','Both'].includes(plan))
  return res.status(400).json({success:false,error:'Check endpoint name, path, method, category and plan.'});
 if(allModules.some(x=>x.path===path))return res.status(409).json({success:false,error:'This path is already registered in code.'});
 const {data,error}=await supabase!.from('api_endpoints').insert({name,path,method,category,plan,description:description||'',handler:handler||'not_implemented',is_active}).select().single();
 if(error)return res.status(400).json({success:false,error:error.message});
 res.status(201).json({success:true,result:data,message:'Metadata saved. Add and deploy a trusted module in backend/src/modules before this endpoint can execute.'});
});
app.patch('/admin/endpoints/:id',async(req,res)=>{
 const allowed=['name','description','category','plan','is_active'];const patch=Object.fromEntries(Object.entries(req.body||{}).filter(([k])=>allowed.includes(k)));
 const {data,error}=await supabase!.from('api_endpoints').update(patch).eq('id',req.params.id).select().single();
 if(error)return res.status(400).json({success:false,error:error.message});res.json({success:true,result:data});
});
app.delete('/admin/endpoints/:id',async(req,res)=>{
 const {error}=await supabase!.from('api_endpoints').delete().eq('id',req.params.id);
 if(error)return res.status(400).json({success:false,error:error.message});res.json({success:true});
});
app.get('/admin/audit',async(_req,res)=>{
 const {data,error}=await supabase!.from('admin_audit_logs').select('*').order('created_at',{ascending:false}).limit(100);
 if(error)return res.status(500).json({success:false,error:error.message});res.json({success:true,result:data});
});

const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`Roxy Main API listening on ${port}`));
