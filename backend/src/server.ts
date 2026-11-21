import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authenticateApiKey } from './middleware/apiKey';
import { enforceQuota, writeUsage } from './middleware/usage';
import { handlers } from './handlers/registry';
import { supabase } from './lib/supabase';

const app = express();
app.set('trust proxy', 1);
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Allow server-to-server calls and explicitly configured browser origins only.
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'x-admin-token', 'Authorization'],
  maxAge: 86400
}));
app.use(express.json({ limit: '1mb' }));

// Railway service root: opening the domain should show service information, not "Cannot GET /".
app.get('/', (_req, res) => res.json({
  success: true,
  service: 'Roxy Main API',
  version: '1.0.0',
  status: 'online',
  health: '/health',
  documentation: 'Open the Roxy frontend /docs page for endpoint documentation.'
}));
app.get('/health', (_req, res) => res.json({
  success: true,
  service: 'Roxy Main API',
  version: '1.0.1',
  status: 'online',
  database: supabase ? 'configured' : 'not_configured',
  time: new Date().toISOString()
}));

const limiter = rateLimit({
  windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' }
});
const endpointHandlers: Record<string, keyof typeof handlers> = {
  '/api/v1/ai/chat': 'echo',
  '/api/v1/text/encode': 'encode',
  '/api/v1/tools/qr': 'qr',
  '/api/v1/image/enhance': 'unavailable'
};

// Public endpoint catalogue consumed by the live documentation page.
app.get('/api/v1/endpoints', async (_req, res) => {
  const fallback = [
    { name: 'AI Chat', path: '/api/v1/ai/chat', method: 'POST', category: 'AI Tools', plan: 'Premium', description: 'Chat completion endpoint.', handler: 'echo' },
    { name: 'Text Encoder', path: '/api/v1/text/encode', method: 'POST', category: 'Utility', plan: 'Free', description: 'Encode text to Base64.', handler: 'encode' },
    { name: 'QR Generator', path: '/api/v1/tools/qr', method: 'POST', category: 'Utility', plan: 'Free', description: 'Generate a QR payload.', handler: 'qr' },
    { name: 'Image Enhancer', path: '/api/v1/image/enhance', method: 'POST', category: 'Image Tools', plan: 'Premium', description: 'Image enhancement endpoint.', handler: 'unavailable' }
  ];
  if (!supabase) return res.json({ success: true, source: 'built_in_registry', endpoints: fallback });
  const { data, error } = await supabase.from('api_endpoints').select('name,path,method,category,plan,description,handler').eq('is_active', true).order('created_at');
  if (error) return res.status(503).json({ success: false, code: 'ENDPOINT_CATALOG_UNAVAILABLE', message: 'Could not load endpoint metadata from Supabase.' });
  const merged = [...fallback];
  for (const item of data || []) if (!merged.some(existing => existing.path === item.path)) merged.push(item);
  return res.json({ success: true, source: 'supabase', endpoints: merged });
});

// Real platform activity summary. No fabricated demo values are returned.
app.get('/public/overview', async (_req, res) => {
  if (!supabase) return res.status(503).json({ success: false, code: 'DATABASE_NOT_CONFIGURED', message: 'Railway needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
  const now = new Date();
  const jakartaParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [year, monthNumber, dayNumber] = jakartaParts.split('-').map(Number);
  const today = new Date(`${jakartaParts}T00:00:00+07:00`);
  const month = new Date(`${year}-${String(monthNumber).padStart(2, '0')}-01T00:00:00+07:00`);
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  const [todayResult, monthResult, weekResult] = await Promise.all([
    supabase.from('api_logs').select('status_code', { count: 'exact' }).gte('created_at', today.toISOString()),
    supabase.from('api_logs').select('id', { count: 'exact', head: true }).gte('created_at', month.toISOString()),
    supabase.from('api_logs').select('status_code,created_at').gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: true }).limit(10000)
  ]);
  const failure = todayResult.error || monthResult.error || weekResult.error;
  if (failure) return res.status(503).json({ success: false, code: 'ANALYTICS_QUERY_FAILED', message: 'Supabase could not read API logs. Check that the supplied schema has been applied.' });
  const todayRows = todayResult.data || [];
  const successful = todayRows.filter(row => row.status_code < 400).length;
  const weekRows = weekResult.data || [];
  const activity = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sevenDaysAgo); date.setUTCDate(date.getUTCDate() + index);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    return { date: key, requests: weekRows.filter(row => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.created_at)) === key).length };
  });
  return res.json({ success: true, result: {
    requestsToday: todayResult.count || 0,
    requestsThisMonth: monthResult.count || 0,
    successRate: todayRows.length ? Number((successful / todayRows.length * 100).toFixed(1)) : 0,
    activity,
    source: 'api_logs'
  }});
});

app.all('/api/v1/*', limiter, authenticateApiKey, enforceQuota, async (req, res) => {
  const started = Date.now();
  const path = req.path;
  const handler = endpointHandlers[path];
  if (!handler) return res.status(404).json({ success: false, code: 'ENDPOINT_NOT_FOUND' });
  const premium = ['/api/v1/ai/chat', '/api/v1/image/enhance'].includes(path);
  if (premium && req.apiUser?.plan !== 'premium') {
    return res.status(403).json({ success: false, code: 'PREMIUM_REQUIRED', message: 'This endpoint requires a Premium subscription.' });
  }
  res.on('finish', () => { void writeUsage(req, res, started, path); });
  return handlers[handler](req, res);
});

app.post('/admin/endpoints', async (req, res) => {
  const token = req.header('x-admin-token');
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  if (!supabase) return res.status(503).json({ error: 'Supabase is not configured. Set SUPABASE_SERVICE_ROLE_KEY in Railway.' });
  const { name, path, method, category, plan, description, handler, is_active } = req.body || {};
  if (!name || !path?.startsWith('/api/v1/')) return res.status(400).json({ error: 'Valid name and /api/v1/ path are required' });
  const { data, error } = await supabase.from('api_endpoints').insert({ name, path, method, category, plan, description, handler, is_active }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ success: true, endpoint: data, message: 'Metadata saved. Register and deploy a trusted handler before exposing this route.' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (String(err?.message || '').startsWith('CORS origin not allowed:')) {
    return res.status(403).json({ success: false, code: 'CORS_ORIGIN_DENIED', message: err.message, hint: 'Add the exact Vercel origin (scheme + hostname, no path) to CORS_ORIGINS in Railway.' });
  }
  console.error('[Roxy API error]', err);
  return res.status(500).json({ success: false, code: 'INTERNAL_SERVER_ERROR' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, '0.0.0.0', () => console.log(`Roxy Main API listening on 0.0.0.0:${port}`));
