import type { Job } from '@/lib/server/jobs';
import { jsonError } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const KEEPALIVE_MS = 15_000;

// Server-Sent Events: one `job` event per update, starting with the current state; the stream
// closes once the job reaches a terminal status.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { queue } = getServices();
  const initial = queue.get(id);
  if (!initial) return jsonError(404, 'Job not found');

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (job: Job) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: job\ndata: ${JSON.stringify(job)}\n\n`));
        if (TERMINAL.has(job.status)) close();
      };
      const unsubscribe = queue.subscribe(id, send);
      const keepalive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, KEEPALIVE_MS);
      cleanup = () => {
        unsubscribe();
        clearInterval(keepalive);
      };
      request.signal.addEventListener('abort', close, { once: true });
      // Re-read after subscribing so an update between get() and subscribe() is not lost.
      send(queue.get(id) ?? initial);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
