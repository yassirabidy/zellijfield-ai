import { NextResponse } from 'next/server';
import { handleError } from '@/lib/server/http';
import { listedModels, listModelsWithStatus } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Registry entries with live availability (installed / missing / unreachable / needs-key).
// ?status=0 skips the backend checks and returns instantly (used to build navigation).
export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('status') === '0') {
      return NextResponse.json({ models: listedModels() });
    }
    return NextResponse.json({ models: await listModelsWithStatus() });
  } catch (err) {
    return handleError(err);
  }
}
