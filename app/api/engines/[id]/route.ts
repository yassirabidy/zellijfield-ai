import { NextResponse } from 'next/server';
import { z } from 'zod';
import { engineActionSchema, engineIdSchema } from '@/lib/server/engines';
import { ClientError, handleError, readJson, rejectCrossOrigin } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ action: engineActionSchema }).strict();

// Asks the engine manager to install, start, stop or delete an engine.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  try {
    const id = engineIdSchema.parse((await params).id);
    const { action } = bodySchema.parse(await readJson(request));
    const { engines, queue } = getServices();
    if (action === 'stop' || action === 'delete') {
      const busy = queue.list(200).some((j) => j.backend === id && (j.status === 'queued' || j.status === 'running'));
      if (busy) throw new ClientError('This engine has queued or running jobs; wait for them or cancel them first.');
    }
    engines.request(id, action);
    return NextResponse.json({ requested: true }, { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}
