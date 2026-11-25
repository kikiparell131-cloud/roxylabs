import {Request,Response,NextFunction} from 'express';
import {supabase} from '../lib/supabase';
export async function enforceQuota(req:Request,res:Response,next:NextFunction){
 if(!req.apiUser||!supabase)return res.status(503).json({success:false,code:'USAGE_SERVICE_UNAVAILABLE'});
 // Owner API keys bypass quota enforcement. Every request is still logged.
 if(req.apiUser.role==='owner'){res.locals.usageDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return next();}
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const {data,error}=await supabase.rpc('consume_api_quota',{p_user_id:req.apiUser.id,p_usage_date:day,p_daily_limit:req.apiUser.daily_limit});
 if(error)return res.status(503).json({success:false,code:'QUOTA_SERVICE_UNAVAILABLE'});
 if(!data?.allowed)return res.status(429).json({success:false,code:'DAILY_LIMIT_EXCEEDED',limit:req.apiUser.daily_limit,remaining:0,reset:'00:00 Asia/Jakarta'});
 res.locals.usageDay=day;
 next();
}
export async function writeUsage(req:Request,res:Response,started:number,endpoint:string){
 if(!supabase||!req.apiUser)return;
 await supabase.from('api_logs').insert({user_id:req.apiUser.id,endpoint,method:req.method,status_code:res.statusCode,response_time_ms:Date.now()-started,ip_address:req.ip});
}
