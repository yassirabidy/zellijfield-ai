import { NextResponse } from 'next/server';
import { handleError, rejectCrossOrigin } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Deletes a local model's weights to free disk space. Files another installed model still
// needs (e.g. a shared text encoder) are kept.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  try {
    return NextResponse.json(await getServices().downloads.remove((await params).id));
  } catch (err) {
    return handleError(err);
  }
}
