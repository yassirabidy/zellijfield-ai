import { NextResponse } from 'next/server';

// Liveness probe for the Docker healthcheck. Never touches backends or secrets.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}
