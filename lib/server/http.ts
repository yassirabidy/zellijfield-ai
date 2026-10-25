import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

// Errors whose message is safe to show the user. Marked with a property rather than checked with
// instanceof: Next bundles each route separately, so the shared job queue may throw an error class
// from a different bundle than the one a route imports.
export class ClientError extends Error {
  readonly expose = true;
}

function isClientError(err: unknown): err is Error {
  return err instanceof Error && (err as { expose?: unknown }).expose === true;
}

// Maps validation errors to 400 with field details; everything else to a generic 500 so internal
// details (paths, upstream responses that may echo headers) are not leaked to the browser.
export function handleError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return jsonError(400, 'Invalid request', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (isClientError(err)) return jsonError(400, err.message);
  console.error('[api] unexpected error:', err instanceof Error ? err.message : String(err));
  return jsonError(500, 'Internal error');
}

// Rejects state-changing requests sent by other websites (CSRF). The studio is bound to localhost
// with no login, so any page open in the same browser could otherwise POST to it.
export function rejectCrossOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return jsonError(403, 'Cross-site request refused');
  if (origin) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    try {
      if (new URL(origin).host !== host) return jsonError(403, 'Cross-origin request refused');
    } catch {
      return jsonError(403, 'Invalid Origin header');
    }
  }
  return null;
}

export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new ZodError([{ code: 'custom', path: [], message: 'Content-Type must be application/json', input: undefined }]);
  return request.json();
}
