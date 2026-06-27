import { reactive } from 'vue';

const TOKEN_KEY = 'pisonet_admin_token';
const SERVER_KEY = 'pisonet_admin_server';
const EMAIL_KEY = 'pisonet_admin_email';

interface AuthState {
  token: string | null;
  email: string | null;
}

export const auth = reactive<AuthState>({
  token: localStorage.getItem(TOKEN_KEY),
  email: localStorage.getItem(EMAIL_KEY),
});

export function setSession(token: string, email: string): void {
  auth.token = token;
  auth.email = email;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

export function clearSession(): void {
  auth.token = null;
  auth.email = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(auth.token);
}

// Server base URL. Defaults to the same origin the portal is served from
// (works when hosted at /admin on the API server). Can be overridden for
// local dev (e.g. Vite on :5174 talking to the API on :3000).
export function getServerUrl(): string {
  const saved = localStorage.getItem(SERVER_KEY);
  if (saved) return saved.replace(/\/$/, '');
  return window.location.origin;
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/$/, '');
  if (trimmed) {
    localStorage.setItem(SERVER_KEY, trimmed);
  } else {
    localStorage.removeItem(SERVER_KEY);
  }
}
