# Roxy Main API — existing project, repaired

This archive is the updated version of the project you uploaded. It preserves the existing `roxy-main-api` structure, Roxy assets, blue/lavender visual direction, and the original Vercel + Railway + Supabase deployment model.

## What was repaired

### Frontend
- Dashboard metrics and seven-day chart now load from backend database queries; removed the hard-coded sample statistics.
- Recent API requests are shown from real API logs.
- Documentation fetches the registered backend endpoints and uses a redesigned responsive endpoint explorer + request playground.
- Playground sends real requests and displays the actual HTTP status, latency, and JSON response.
- Login and registration are connected to Supabase Auth.
- Profile loads the real account, creates API keys (raw key is shown only once), and allows key revocation.
- Admin UI uses the signed-in Supabase session and exposes live user, premium, endpoint metadata, and API-log management.

### Backend
- Verifies Supabase access tokens for user/admin dashboard routes.
- Admin routes require the verified account role `owner`; Free and Premium accounts receive HTTP 403.
- API keys are stored as SHA-256 hashes; raw keys are only returned at creation.
- Premium expiry is checked server-side.
- Daily quota reservation uses an atomic Postgres RPC to avoid parallel-request quota bypass.
- API calls are logged with status and response time.
- Endpoint modules are discovered from trusted JavaScript files in `backend/api/`, but the public API catalog stays empty until the owner registers a module from the web Admin Dashboard. Registration connects the selected file to its real API route and publishes it in Docs. Arbitrary JavaScript uploaded from the public browser is never executed.

## Local setup

1. Use Node.js 20+ and npm.
2. Copy root `.env.example` values into `frontend/.env.local` and `backend/.env`.
3. Create a Supabase project and run `supabase/schema.sql` in the Supabase SQL Editor. The schema also backfills profile rows for users who registered before the trigger was installed.
4. Enable Email + Password in Supabase Authentication. Configure the site URL and redirect URLs for localhost and your deployed Vercel domain.
5. Install from the repository root: `npm install`.
6. Start both services: `npm run dev`.
7. Frontend: `http://localhost:3000`; backend health: `http://localhost:4000/health`.

## Environment variables

### Frontend — Vercel / `frontend/.env.local`
- `NEXT_PUBLIC_API_URL` — public Railway backend URL, e.g. `https://roxy-backend-production.up.railway.app`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_ADMIN_WHATSAPP` — admin number in international digits, without `+`

### Backend — Railway / `backend/.env`
- `PORT` — Railway supplies this automatically; local default is `4000`
- `CORS_ORIGINS` — comma-separated exact frontend origins, e.g. `https://roxylabs-two.vercel.app` (do not include a trailing slash)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only; never use a `NEXT_PUBLIC_` prefix

## Set the owner role

Run `supabase/role_migration.sql` in the Supabase SQL Editor. Replace `YOUR_OWNER_EMAIL@example.com` with the email address of the account that should own the project, then run the final `UPDATE` statement. The role is stored in `profiles.role` and must be exactly `owner`. Do not grant owner through the web UI.

Roles:
- `free`: standard user; no Admin Dashboard access.
- `premium`: Premium API access; no Admin Dashboard access.
- `owner`: full Admin Dashboard access, Premium endpoint access, and API quota bypass.

The backend enforces owner-only access independently of whether the Admin link is visible in the frontend.

## Add a JavaScript API module (Railway)

Create `backend/api/ai.js`:

```js
module.exports = {
  name: 'AI Chat',
  path: '/api/v1/ai/chat',
  method: 'POST',
  category: 'AI Tools',
  plan: 'Premium',
  description: 'AI chat endpoint',
  async execute(req, res) {
    const { message } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, code: 'MESSAGE_REQUIRED' });
    }

    // Call your chosen provider here. Keep API secrets in Railway variables.
    return res.json({ success: true, result: { message: 'Provider integration goes here' } });
  }
};
```

The backend loads `.js` modules in `backend/api/` when the Railway service starts. Give each module a unique `path`. Supported methods: GET, POST, PUT, PATCH, DELETE. Commit and redeploy to Railway after adding or changing code.

A scraper starter is included as `backend/api/scraper.example.txt`; copy it to `backend/api/scraper.js` after implementing it. Scrapers must defend against SSRF (block loopback/private/link-local destinations), use destination allowlists, and enforce timeouts and response-size limits.

## Fix for Railway `Cannot GET /` and frontend `Failed to fetch`

- Opening the Railway domain at `/` now returns a JSON service overview instead of Express `Cannot GET /`.
- `/health` reports whether the backend can reach the Supabase database.
- The Vercel dashboard checks `/health` before requesting dashboard data and reports the failing layer.
- In Railway, you MUST set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The Supabase anon key in Vercel is only for browser-side Supabase Auth; it does not configure the backend database connection.
- In Vercel, set `NEXT_PUBLIC_API_URL` to the full Railway origin, for example `https://roxy-backend-production.up.railway.app` (no path and no trailing slash).
- In Railway, set `CORS_ORIGINS` to the exact Vercel origin, for example `https://roxylabs-two.vercel.app` (no trailing slash).
- Redeploy Railway after changing Railway variables, and redeploy Vercel after changing `NEXT_PUBLIC_*` variables.

## Deploy

- **Vercel:** import the same repository, set Root Directory to `frontend`, and add the frontend environment variables.
- **Railway:** deploy the same repository, set Root Directory to `backend`, and add the backend environment variables. The service health check is `/health`. The backend root `/` now returns a JSON service overview; it is an API service, not the website UI.
- **Supabase:** apply `supabase/schema.sql` and promote your admin user as described above.

## Important

- Payment gateway is intentionally not included. Premium activation remains manual through the WhatsApp link on Pricing; an admin can grant or revoke Premium in Admin Dashboard.
- The AI, QR, and image-provider integrations still need their real provider logic. They return explicit `501` configuration responses rather than pretending to process a request.
- This is a repaired application foundation, not a completed security audit. Before public launch, add monitoring/retention policies, provider timeouts, request validation per endpoint, and Redis-backed distributed rate limiting if running multiple Railway replicas.


## Roles and endpoint publishing

Roles are `free`, `premium`, and `owner`. Only `owner` can access `/admin/*`; the backend checks the verified Supabase user and the `profiles.role` value on every admin request. Free and Premium users receive HTTP 403 even if they manually enter `/admin`. The owner role is assigned manually in Supabase with `supabase/role_migration.sql`; the web dashboard cannot promote accounts to owner. Premium management can only switch ordinary accounts between Free and Premium.

Run `supabase/role_migration.sql` once on an existing database, replace `YOUR_OWNER_EMAIL@example.com` with the owner's Supabase login email, and run the final update statement. Do not expose the Service Role key.

The API catalog intentionally starts empty. JavaScript files placed in `backend/api/*.js` are discovered as available modules but are not public or executable until the owner opens Admin Dashboard → Endpoint Management → Add endpoint and registers the file. Registration writes its module reference to `api_endpoints`, activates its real backend handler immediately, and makes it appear in `/docs`. If a file is changed or added, redeploy the Railway backend; then register it in the web dashboard. Deleting/disabling the registration removes it from public docs and disables its route.

Owner API keys bypass daily quota and can call Premium endpoints. Owner status is still required for all admin dashboard operations.

## Endpoint categories, response identity, and Pinterest PinDL
- When registering a module in Admin → Endpoint Management, set its short **Endpoint label** and **Category / menu group**. For example, use `Download` as the category and `TikTokDL` / `PinDL` as the endpoint labels. API Docs groups endpoints by category.
- API JSON responses include the required top-level `api: "roxylabs"` identity.
- API Docs has a **Copy JSON** action for response payloads.
- Added `backend/api/pindl.js` for public Pinterest pin page metadata and available image/video URLs. Register it in the owner dashboard after deploying the backend. Pinterest may restrict media metadata; this module does not guarantee a downloadable original file for every pin.
- Redeploy backend and frontend after pushing the changes. Existing registered endpoint rows keep their current category/name; adjust them in Supabase or re-register after deleting the old row if you want to rename existing entries.
