import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getServices().queue.get(id);
  return job ? NextResponse.json({ job }) : jsonError(404, 'Job not found');
}
