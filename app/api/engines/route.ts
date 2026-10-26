import { NextResponse } from 'next/server';
import { handleError } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Wan2GP / ComfyUI engines as reported by the Windows-side engine manager.
export async function GET() {
  try {
    return NextResponse.json(getServices().engines.snapshot());
  } catch (err) {
    return handleError(err);
  }
}
