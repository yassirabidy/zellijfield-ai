import { muapiKey } from '@/lib/server/muapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MUAPI_BASE = 'https://api.muapi.ai';
// Never forward browser credentials or hop-by-hop headers upstream.
const DROP = ['host', 'connection', 'cookie', 'authorization', 'x-api-key', 'content-length', 'accept-encoding'];

// Proxies /api/v1/* to api.muapi.ai with the server-side key. Replaces the middleware rewrite,
// which could not attach a key the browser no longer holds. More specific /api/v1/* routes
// (creative-agent, get_upload_url, upload-binary) take precedence over this catch-all.
async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.some((s) => s === '..' || s === '.')) return Response.json({ error: 'Invalid path' }, { status: 400 });
  const { search } = new URL(request.url);
  const target = `${MUAPI_BASE}/api/v1/${path.map(encodeURIComponent).join('/')}${search}`;

  const headers = new Headers(request.headers);
  for (const h of DROP) headers.delete(h);
  const key = muapiKey();
  if (key) headers.set('x-api-key', key);

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  try {
    const upstream = await fetch(target, init);
    const body = await upstream.arrayBuffer();
    const out = new Headers();
    const type = upstream.headers.get('content-type');
    if (type) out.set('content-type', type);
    return new Response(body, { status: upstream.status, headers: out });
  } catch {
    return Response.json({ error: 'Muapi is not reachable' }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as PATCH };
