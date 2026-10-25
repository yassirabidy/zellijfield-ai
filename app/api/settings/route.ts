import { NextResponse } from 'next/server';
import { handleError, readJson, rejectCrossOrigin } from '@/lib/server/http';
import { getPublicSettings, updateSettings } from '@/lib/server/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// API keys are never returned: only `keys: { muapi: true/false, ... }`.
export function GET() {
  try {
    return NextResponse.json(getPublicSettings());
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(request: Request) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  try {
    return NextResponse.json(updateSettings(await readJson(request)));
  } catch (err) {
    return handleError(err);
  }
}
