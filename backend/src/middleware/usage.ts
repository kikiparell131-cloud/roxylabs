import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

function jakartaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export async function enforceQuota(req: Request, res: Response, next: NextFunction) {
  if (!req.apiUser || !supabase) return res.status(503).json({ success: false, code: 'USAGE_SERVICE_UNAVAILABLE' });
  const day = jakartaDate();
  const { data, error } = await supabase.from('api_usage_daily').select('request_count').eq('user_id', req.apiUser.id).eq('usage_date', day).maybeSingle();
  if (error) return res.status(503).json({ success: false, code: 'USAGE_LOOKUP_FAILED', message: 'Could not read daily API quota.' });
  const used = data?.request_count || 0;
  if (used >= req.apiUser.daily_limit) return res.status(429).json({ success: false, code: 'DAILY_LIMIT_EXCEEDED', limit: req.apiUser.daily_limit, remaining: 0, reset: '00:00 Asia/Jakarta' });
  res.locals.usageDay = day;
  next();
}

export async function writeUsage(req: Request, res: Response, started: number, endpoint: string) {
  if (!supabase || !req.apiUser) return;
  const day = res.locals.usageDay || jakartaDate();
  const status = res.statusCode;
  // RPC increments the counter atomically so simultaneous requests cannot overwrite each other.
  const { error: usageError } = await supabase.rpc('increment_api_usage', { p_user_id: req.apiUser.id, p_usage_date: day });
  if (usageError) console.error('[usage increment failed]', usageError.message);
  const { error: logError } = await supabase.from('api_logs').insert({
    user_id: req.apiUser.id, endpoint, method: req.method, status_code: status,
    response_time_ms: Date.now() - started, ip_address: req.ip
  });
  if (logError) console.error('[api log insert failed]', logError.message);
}
