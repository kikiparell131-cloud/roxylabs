import {Request,Response,NextFunction} from 'express';
import {createClient} from '@supabase/supabase-js';
import {supabase} from '../lib/supabase';
declare global { namespace Express { interface Request { sessionUser?: {id:string;email?:string;role:'free'|'premium'|'owner';is_admin:boolean} } } }
export async function requireSession(req:Request,res:Response,next:NextFunction){
  const h=req.header('authorization')||'';
  const token=h.startsWith('Bearer ')?h.slice(7):'';
  if(!token||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return res.status(401).json({success:false,code:'AUTH_REQUIRED'});
  const authClient=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const {data,error}=await authClient.auth.getUser(token);
  if(error||!data.user)return res.status(401).json({success:false,code:'INVALID_SESSION'});
  if(!supabase)return res.status(503).json({success:false,code:'DATABASE_NOT_CONFIGURED'});
  const {data:profile}=await supabase.from('profiles').select('id,username,plan,role,status,is_admin,premium_expires_at,custom_daily_limit').eq('id',data.user.id).maybeSingle();
  if(!profile||profile.status!=='active')return res.status(403).json({success:false,code:'ACCOUNT_DISABLED'});
  let role=(profile.role|| (profile.is_admin?'owner':profile.plan==='premium'?'premium':'free')) as 'free'|'premium'|'owner';
  if(role==='premium'&&profile.premium_expires_at&&new Date(profile.premium_expires_at)<new Date()){
    await supabase.from('profiles').update({plan:'free',role:'free',premium_expires_at:null}).eq('id',data.user.id);
    profile.plan='free';role='free';
  }
  req.sessionUser={id:data.user.id,email:data.user.email,role,is_admin:role==='owner'};
  res.locals.profile=profile;
  next();
}
export function requireAdmin(req:Request,res:Response,next:NextFunction){
  if(req.sessionUser?.role!=='owner')return res.status(403).json({success:false,code:'OWNER_ONLY',message:'Only the owner role can access the admin dashboard.'});
  next();
}
