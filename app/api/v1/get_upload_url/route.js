import { NextResponse } from 'next/server';
import { muapiKey } from '@/lib/server/muapi';

const MUAPI_BASE = 'https://api.muapi.ai';

// Zellijfield AI: the Muapi key is stored server-side (Settings) and never sent by the browser.
function getApiKey() {
    return muapiKey();
}

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie');
    headers.delete('authorization');
    return headers;
}

export async function GET(request) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return NextResponse.json({ error: 'Unauthorized: Missing API key' }, { status: 401 });
    }

    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/app/get_file_upload_url${search}`;

    const headers = cleanHeaders(request);
    headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, {
            headers,
            method: 'GET',
        });

        const data = await response.json();

        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

