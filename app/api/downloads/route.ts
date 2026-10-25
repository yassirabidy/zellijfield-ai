import { NextResponse } from 'next/server';
import { handleError } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Download progress and local file state of every local model (polled by the Models page).
export async function GET() {
  try {
    return NextResponse.json({ models: await getServices().downloads.overview() });
  } catch (err) {
    return handleError(err);
  }
}
