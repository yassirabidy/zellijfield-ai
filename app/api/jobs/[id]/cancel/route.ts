import { NextResponse } from 'next/server';
import { jsonError, rejectCrossOrigin } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  const { id } = await params;
  const { queue } = getServices();
  if (!queue.get(id)) return jsonError(404, 'Job not found');
  return NextResponse.json({ cancelled: queue.cancel(id) });
}
