import { NextResponse } from 'next/server';
import { handleError, rejectCrossOrigin } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

// Starts downloading a local model's weights (sources come from models.json only).
export async function POST(request: Request, { params }: Context) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  try {
    await getServices().downloads.start((await params).id);
    return NextResponse.json({ started: true }, { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}

// Cancels the running download; a ComfyUI download resumes where it stopped next time.
export async function DELETE(request: Request, { params }: Context) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  try {
    await getServices().downloads.cancel((await params).id);
    return NextResponse.json({ cancelled: true });
  } catch (err) {
    return handleError(err);
  }
}
