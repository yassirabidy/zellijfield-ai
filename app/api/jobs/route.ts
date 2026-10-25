import { NextResponse } from 'next/server';
import { handleError, readJson, rejectCrossOrigin } from '@/lib/server/http';
import { JobInputError, jobInputSchema } from '@/lib/server/jobs';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  try {
    const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 50));
    return NextResponse.json({ jobs: getServices().queue.list(limit) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: Request) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  try {
    const input = jobInputSchema.parse(await readJson(request));
    const job = getServices().queue.submit(input);
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    return handleError(err, [JobInputError]);
  }
}
