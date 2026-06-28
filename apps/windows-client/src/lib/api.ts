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

export interface ClaimComputerResponse {
  computerId: string;
  authSecret: string;
  computerCode: string;
  name: string;
}

// Quick-pair: redeem a short code from the admin portal for this PC's credentials.
export async function claimComputer(
  serverUrl: string,
  code: string
): Promise<ClaimComputerResponse> {
  return apiRequest<ClaimComputerResponse>(serverUrl, '/computers/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export interface SessionLoginResponse {
  token: string;
  sessionId: string;
  remainingSeconds: number;
  username: string;
  loyaltyStamps: number;
}

export async function passwordLogin(
  serverUrl: string,
  username: string,
  password: string,
  computerId: string
): Promise<SessionLoginResponse> {
  return apiRequest<SessionLoginResponse>(serverUrl, '/auth/password-login', {
    method: 'POST',
    body: JSON.stringify({ username, password, computerId }),
  });
}

export interface RegisterPayload {
  username: string;
  nickname?: string;
  password: string;
  pin?: string;
  mobileNumber?: string;
}

export async function registerUser(
  serverUrl: string,
  payload: RegisterPayload
): Promise<{ token: string }> {
  return apiRequest(serverUrl, '/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function changePassword(
  serverUrl: string,
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean }> {
  return apiRequest(serverUrl, '/auth/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
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
