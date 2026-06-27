export const SessionStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const ComputerStatus = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  IN_USE: 'IN_USE',
  LOCKED: 'LOCKED',
} as const;

export type ComputerStatus = (typeof ComputerStatus)[keyof typeof ComputerStatus];

export const WsEvents = {
  START_SESSION: 'START_SESSION',
  PAUSE_SESSION: 'PAUSE_SESSION',
  ADD_TIME: 'ADD_TIME',
  END_SESSION: 'END_SESSION',
  SESSION_ENDED: 'SESSION_ENDED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORCE_LOCK: 'FORCE_LOCK',
  SHUTDOWN: 'SHUTDOWN',
  HEARTBEAT: 'HEARTBEAT',
  COMPUTER_STATUS: 'COMPUTER_STATUS',
  SESSION_STATE: 'SESSION_STATE',
} as const;

export type WsEvent = (typeof WsEvents)[keyof typeof WsEvents];

export interface StartSessionPayload {
  sessionId: string;
  userId: string;
  username: string;
  remainingSeconds: number;
  startedAt: string;
}

export interface AddTimePayload {
  sessionId: string;
  remainingSeconds: number;
}

export interface SessionStatePayload {
  sessionId: string;
  userId: string;
  username: string;
  remainingSeconds: number;
  status: SessionStatus;
}

export interface ForceLockPayload {
  reason?: string;
}
