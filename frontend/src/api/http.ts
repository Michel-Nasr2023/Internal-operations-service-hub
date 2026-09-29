export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

// Fired with `true` / `false` when the server becomes reachable / unreachable (drives the connection banner).
export const CONNECTION_EVENT = 'internal-ops-connection';
export const DEFAULT_TIMEOUT_MS = 30_000;
// Uploading or downloading files of up to 10 MB on a slow connection takes longer.
export const TRANSFER_TIMEOUT_MS = 120_000;

let serverReachable = true;

export function reportConnection(reachable: boolean): void {
  if (reachable === serverReachable) return;
  serverReachable = reachable;
  window.dispatchEvent(new CustomEvent<boolean>(CONNECTION_EVENT, { detail: reachable }));
}

// Every API request goes through here: a time limit, and a clear message when the server cannot be reached,
// instead of the browser's "Failed to fetch" or a spinner that never stops.
export async function apiFetch(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    reportConnection(false);
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new Error(timedOut ? 'The server is taking too long to respond. Please try again.' : "Can't reach the server. Check your connection and try again.");
  }
  reportConnection(true);
  return response;
}
