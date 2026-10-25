import { NextResponse } from 'next/server';
import { handleError, jsonError, rejectCrossOrigin } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';
import { MAX_UPLOAD_BYTES, saveUpload } from '@/lib/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// multipart/form-data with one `file` field. Returns { id, kind } for use in POST /api/jobs.
export async function POST(request: Request) {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) return jsonError(413, 'The file is larger than 50 MB.');
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) return jsonError(400, 'Missing "file" field');
    const saved = saveUpload(getServices().uploadsDir, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
