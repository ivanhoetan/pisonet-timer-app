import { auth, clearSession, getServerUrl } from './auth';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Network error — is the server reachable?', 0);
  }

  if (response.status === 401) {
    clearSession();
    throw new ApiError('Session expired. Please log in again.', 401);
  }

  let data: any = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && data.error) || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
};

// ---- Typed responses ----

export interface ActiveSessionInfo {
  sessionId: string;
  computerId: string;
  remainingSeconds: number;
}

export interface AdminUser {
  id: string;
  username: string;
  balanceSeconds: number;
  mobileNumber?: string;
  status: 'active' | 'disabled';
  loyaltyStamps: number;
  points: number;
  createdAt: string;
  activeSession: ActiveSessionInfo | null;
}

export interface Computer {
  _id: string;
  computerCode: string;
  name: string;
  status: 'ONLINE' | 'OFFLINE' | 'IN_USE' | 'LOCKED' | 'MAINTENANCE';
  lastOnline?: string;
}

export interface LiveSession {
  sessionId: string;
  userId: string;
  username: string;
  computerId: string;
  computerCode: string;
  remainingSeconds: number;
  startedAt: string;
}

export interface Overview {
  users: { total: number; active: number; disabled: number };
  computers: { total: number; online: number; offline: number; inUse: number; locked: number };
  activeSessions: number;
  today: { topups: number; minutesSold: number; revenue: number };
}

export interface Transaction {
  _id: string;
  userId: { _id: string; username: string } | string;
  minutesAdded: number;
  amountPaid?: number;
  paymentMethod: string;
  paymentReference?: string;
  createdAt: string;
}

export interface AuditEntry {
  _id: string;
  actorEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  details?: string;
  createdAt: string;
}

export interface AdminAccount {
  _id: string;
  email: string;
  role: 'owner' | 'staff';
  createdAt: string;
}

export interface EodReport {
  start: string;
  end: string;
  summary: {
    revenue: number;
    minutesSold: number;
    minutesRemoved: number;
    topupCount: number;
    adjustmentCount: number;
    transactionCount: number;
    newUsers: number;
    sessionsStarted: number;
  };
  byMethod: Array<{ method: string; count: number; amount: number; minutes: number }>;
  transactions: Array<{
    createdAt: string;
    username: string;
    minutesAdded: number;
    amountPaid: number;
    paymentMethod: string;
    paymentReference: string;
  }>;
}

export interface LoyaltyReport {
  start: string;
  end: string;
  summary: {
    stampsEarned: number;
    stampsRedeemed: number;
    rewardsRedeemed: number;
    pointsAwarded: number;
    earnEventCount: number;
    redeemEventCount: number;
  };
  outstanding: {
    totalStamps: number;
    totalPoints: number;
    usersWithStamps: number;
    redeemableRewards: number;
  };
  byUser: Array<{
    username: string;
    stampsEarned: number;
    stampsRedeemed: number;
    rewardsRedeemed: number;
  }>;
  events: Array<{
    createdAt: string;
    username: string;
    type: 'earn' | 'redeem';
    stamps: number;
    rewards: number;
    minutes: number;
  }>;
}
