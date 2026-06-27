import { normalizeServerUrl } from './config';

/** Max wait while Render (or similar) cold-starts after sleep (~30–60s). */
const WARMUP_TIMEOUT_MS = 90_000;

/**
 * Hit /health so a sleeping cloud backend wakes before login or WebSocket connect.
 * Failures are ignored; the socket client keeps retrying.
 */
export async function warmUpServer(serverUrl: string): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);

  try {
    await fetch(`${base}/health`, { signal: controller.signal });
  } catch {
    // Cold start may still be in progress, or the network is down.
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiRequest<T>(
  serverUrl: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = normalizeServerUrl(serverUrl);
  const response = await fetch(`${base}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data as T;
}

export interface PinLoginResponse {
  token: string;
  sessionId: string;
  remainingSeconds: number;
  username: string;
}

export async function pinLogin(
  serverUrl: string,
  username: string,
  pin: string,
  computerId: string
): Promise<PinLoginResponse> {
  return apiRequest<PinLoginResponse>(serverUrl, '/auth/pin-login', {
    method: 'POST',
    body: JSON.stringify({ username, pin, computerId }),
  });
}

export async function pinLogout(
  serverUrl: string,
  username: string,
  pin: string,
  computerId: string
): Promise<{ remainingSeconds: number }> {
  return apiRequest(serverUrl, '/auth/pin-logout', {
    method: 'POST',
    body: JSON.stringify({ username, pin, computerId }),
  });
}

export async function endComputerSession(
  serverUrl: string,
  computerId: string,
  authSecret: string,
  sessionId: string
): Promise<{ remainingSeconds: number }> {
  return apiRequest(serverUrl, '/computers/end-session', {
    method: 'POST',
    body: JSON.stringify({ computerId, authSecret, sessionId }),
  });
}

export async function endSession(
  serverUrl: string,
  token: string,
  sessionId: string
): Promise<{ remainingSeconds: number }> {
  return apiRequest(serverUrl, '/sessions/end', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId }),
  });
}
