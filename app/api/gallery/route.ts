import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/server/env';
import { listGallery } from '@/lib/server/gallery';
import { handleError } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const items = listGallery(getEnv().outputsDir, getServices().queue.list(500));
    return NextResponse.json({ items });
  } catch (err) {
    return handleError(err);
  }
}
