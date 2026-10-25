import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

// Maps validation errors to 400 with field details; everything else to a generic 500 so internal
// details (paths, upstream responses that may echo headers) are not leaked to the browser.
export function handleError(err: unknown, knownClientErrors: Array<new (...args: never[]) => Error> = []): NextResponse {
  if (err instanceof ZodError) {
    return jsonError(400, 'Invalid request', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (knownClientErrors.some((E) => err instanceof E)) return jsonError(400, (err as Error).message);
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
