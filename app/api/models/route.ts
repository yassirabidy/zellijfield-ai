import { NextResponse } from 'next/server';
import { handleError } from '@/lib/server/http';
import { listModelsWithStatus } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Registry entries with live availability (installed / missing / unreachable / needs-key).
export async function GET() {
  try {
    const models = await listModelsWithStatus();
    return NextResponse.json({ models });
  } catch (err) {
    return handleError(err);
  }
}
