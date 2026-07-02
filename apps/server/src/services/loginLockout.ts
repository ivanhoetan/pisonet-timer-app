import { LoginLockout } from '../models/LoginLockout';

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

export function userAccountKey(username: string): string {
  return `user:${username.trim()}`;
}

export function adminAccountKey(email: string): string {
  return `admin:${email.trim().toLowerCase()}`;
}

export function lockoutMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `Too many tries — wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
}

export async function getLoginLockout(
  accountKey: string
): Promise<{ locked: boolean; retryAfterMs: number; attempts: number }> {
  const row = await LoginLockout.findOne({ accountKey });
  if (!row) {
    return { locked: false, retryAfterMs: 0, attempts: 0 };
  }

  const now = Date.now();
  if (row.lockedUntil && row.lockedUntil.getTime() > now) {
    return {
      locked: true,
      retryAfterMs: row.lockedUntil.getTime() - now,
      attempts: row.failedAttempts,
    };
  }

  if (row.lockedUntil || row.failedAttempts > 0) {
    row.failedAttempts = 0;
    row.lockedUntil = undefined;
    await row.save();
  }

  return { locked: false, retryAfterMs: 0, attempts: 0 };
}

export async function recordFailedLogin(
  accountKey: string
): Promise<{ locked: boolean; retryAfterMs: number; attempts: number }> {
  const now = new Date();
  let row = await LoginLockout.findOne({ accountKey });

  if (!row) {
    row = await LoginLockout.create({ accountKey, failedAttempts: 0 });
  } else if (row.lockedUntil && row.lockedUntil.getTime() <= now.getTime()) {
    row.failedAttempts = 0;
    row.lockedUntil = undefined;
  }

  row.failedAttempts += 1;

  if (row.failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    row.lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS);
    await row.save();
    return {
      locked: true,
      retryAfterMs: LOGIN_LOCKOUT_MS,
      attempts: row.failedAttempts,
    };
  }

  await row.save();
  return { locked: false, retryAfterMs: 0, attempts: row.failedAttempts };
}

export async function clearLoginLockout(accountKey: string): Promise<void> {
  await LoginLockout.deleteOne({ accountKey });
}
