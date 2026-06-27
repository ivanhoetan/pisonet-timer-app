import { normalizeServerUrl } from './config';

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
