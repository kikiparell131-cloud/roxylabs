# Roxy Main API v1.0.1 — fixes for original project

This patch keeps the original Roxy Main API project structure and visual assets. It fixes the Railway root route, CORS diagnostics, Supabase backend configuration checks, live dashboard analytics, and API docs backend URL handling.

## Important: two different Supabase keys

**Vercel (frontend):**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable/anon key)
- `NEXT_PUBLIC_API_URL` = the Railway backend origin, e.g. `https://your-service.up.railway.app` (no `/health`, no trailing slash)

**Railway (backend):**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase Project Settings → API → `service_role` secret. The backend uses this key for secure server-side reads/writes. The anon key alone is NOT sufficient for this backend configuration.
- `CORS_ORIGINS` = exact Vercel origin, e.g. `https://roxy-labs-two.vercel.app`, plus localhost if needed. No route path and no trailing slash.
- `PORT` is provided by Railway; code falls back to 4000 for local use.

Never put `SUPABASE_SERVICE_ROLE_KEY` or `ADMIN_BOOTSTRAP_TOKEN` in Vercel `NEXT_PUBLIC_*` variables or frontend code. Redeploy Railway after changing Railway variables, and redeploy Vercel after changing Vercel variables.

## Deploy the backend on Railway
1. Open the existing Railway backend service.
2. Set **Root Directory** to `/backend` if deploying this monorepo as a service from its root. If Railway is configured to deploy from the repository root, set the build command to `npm install && npm run build -w backend` and start command to `npm run start -w backend`.
3. Set the Railway variables listed above.
4. Redeploy. Opening the Railway domain `/` now returns service JSON instead of `Cannot GET /`.
5. Check `https://YOUR-RAILWAY-SERVICE.up.railway.app/health`. The JSON should show `status: online` and `database: configured`.

## Deploy the frontend on Vercel
1. Set Root Directory to `frontend`.
2. Add `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Add the exact Vercel domain to Railway `CORS_ORIGINS`.
4. Redeploy Vercel and Railway if their environment variables changed.

## Supabase setup
Run `supabase/schema.sql` in the Supabase SQL Editor. The SQL includes the original tables and the atomic daily-usage RPC required by this patch. For an existing project, apply the new function below separately if you do not want to rerun the full schema:

```sql
create or replace function public.increment_api_usage(p_user_id uuid, p_usage_date date)
returns void language sql security definer set search_path = public as $$
  insert into public.api_usage_daily(user_id, usage_date, request_count)
  values (p_user_id, p_usage_date, 1)
  on conflict (user_id, usage_date)
  do update set request_count = public.api_usage_daily.request_count + 1;
$$;
revoke all on function public.increment_api_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.increment_api_usage(uuid, date) to service_role;
```

## What the errors mean
- `Cannot GET /` on the Railway domain meant Express had no `/` route. This patch adds one; `/health` remains the health check.
- `TypeError: Failed to fetch` in the browser is usually a wrong `NEXT_PUBLIC_API_URL`, Railway service not running, or CORS origin mismatch. `/health` and the docs status badge help isolate it.
- Supplying only Supabase URL + anon key to Railway leaves this backend's `supabase` client unset. Add `SUPABASE_SERVICE_ROLE_KEY` in Railway. Keep the anon key on Vercel only.
- If `/health` reports `database: configured` but dashboard says `ANALYTICS_QUERY_FAILED`, run the matching `supabase/schema.sql` and verify `api_logs` exists.

## Live dashboard and endpoints
- `/public/overview` returns actual counts from `api_logs` (month, today, success rate, seven-day activity). No fabricated numbers are used.
- `/api/v1/endpoints` returns the built-in endpoint catalogue and merges active endpoint metadata from Supabase.
- `/api/v1/ai/chat` remains a safe echo demo and is not connected to a real LLM provider yet.
- `/api/v1/text/encode` is functional.
- QR and image endpoints return 501 until their actual providers/handlers are configured.

## Security notes
The original admin bootstrap-token route remains temporary scaffolding. Do not expose its token in frontend variables. Before public launch, replace it with verified Supabase JWT + server-side admin-role authorization. Add atomic quota reservation (the current request pre-check is not a complete concurrency-safe quota gate), request schema validation, provider timeouts, log retention/redaction, and a production security review.
