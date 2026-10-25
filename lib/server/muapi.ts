import { getApiKey } from './settings';

// The Muapi key is optional and lives server-side (Settings page → SQLite). The browser never holds
// it; proxy routes under /api/* attach it when forwarding to api.muapi.ai.
export function muapiKey(): string | null {
  return getApiKey('muapi');
}

// Placeholder the browser sends in x-api-key so upstream studio code that checks "is there a key?"
// keeps working. Proxies ignore it and use the stored key instead.
export const SERVER_KEY_PLACEHOLDER = 'server-managed';
