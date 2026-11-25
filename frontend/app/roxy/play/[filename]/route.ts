import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  if (!/^[a-z0-9][a-z0-9-]{0,100}-[a-f0-9]{10}\.mp3$/i.test(filename)) {
    return Response.json({ success: false, code: 'INVALID_FILENAME' }, { status: 400 });
  }
  const backend = (process.env.ROXY_BACKEND_ORIGIN || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
  if (!backend) return Response.json({ success: false, code: 'BACKEND_NOT_CONFIGURED' }, { status: 503 });
  let upstream: Response;
  try {
    upstream = await fetch(`${backend}/roxy/play/${encodeURIComponent(filename)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    return Response.json({ success: false, code: 'DOWNLOAD_PROXY_FAILED' }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => '');
    return new Response(body || JSON.stringify({ success: false, code: 'DOWNLOAD_NOT_AVAILABLE' }), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
    });
  }
  const headers = new Headers();
  headers.set('content-type', 'audio/mpeg');
  headers.set('content-disposition', `attachment; filename=\"${filename}\"`);
  headers.set('cache-control', 'private, no-store, max-age=0');
  const length = upstream.headers.get('content-length');
  if (length) headers.set('content-length', length);
  return new Response(upstream.body, { status: 200, headers });
}
