import {Request,Response,NextFunction} from 'express';import {createHash} from 'node:crypto';import {supabase} from '../lib/supabase';
export type ApiUser={id:string;plan:'free'|'premium';role:'free'|'premium'|'owner';daily_limit:number};
declare global{namespace Express{interface Request{apiUser?:ApiUser}}}
export async function authenticateApiKey(req:Request,res:Response,next:NextFunction){
 const raw=req.header('x-api-key');if(!raw)return res.status(401).json({success:false,code:'API_KEY_REQUIRED',message:'Provide x-api-key header.'});
 if(!supabase)return res.status(503).json({success:false,code:'DATABASE_NOT_CONFIGURED'});
 const hash=createHash('sha256').update(raw).digest('hex');
 const {data:key,error}=await supabase.from('api_keys').select('id,user_id,is_active').eq('key_hash',hash).maybeSingle();
 if(error||!key||!key.is_active)return res.status(401).json({success:false,code:'INVALID_API_KEY'});
 const {data:profile}=await supabase.from('profiles').select('id,plan,role,status,custom_daily_limit,premium_expires_at').eq('id',key.user_id).maybeSingle();
 if(!profile||profile.status!=='active')return res.status(403).json({success:false,code:'ACCOUNT_DISABLED'});
 const role=(profile.role||(profile.plan==='premium'?'premium':'free')) as 'free'|'premium'|'owner';
 const premiumValid=role==='owner'||(profile.plan==='premium'&&(!profile.premium_expires_at||new Date(profile.premium_expires_at)>new Date()));
 req.apiUser={id:profile.id,role,plan:premiumValid?'premium':'free',daily_limit:profile.custom_daily_limit||(premiumValid?1000:200)};
 void supabase.from('api_keys').update({last_used_at:new Date().toISOString()}).eq('id',key.id);
 next();
}
