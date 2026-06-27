import { io, Socket } from 'socket.io-client';
import type { StartSessionPayload, AddTimePayload } from '@pisonet/shared';
import { toWsUrl } from './config';

const WsEvents = {
  START_SESSION: 'START_SESSION',
  ADD_TIME: 'ADD_TIME',
  SESSION_ENDED: 'SESSION_ENDED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORCE_LOCK: 'FORCE_LOCK',
  HEARTBEAT: 'HEARTBEAT',
} as const;

export type SessionEventHandler = (payload: StartSessionPayload) => void;
export type AddTimeHandler = (payload: AddTimePayload) => void;
export type VoidHandler = (payload?: { reason?: string }) => void;

export class SocketClient {
  private socket: Socket | null = null;
  private reconnectAttempt = 0;

  connect(
    serverUrl: string,
    computerId: string,
    authSecret: string,
    handlers: {
      onConnect?: () => void;
      onDisconnect?: () => void;
      onStartSession?: SessionEventHandler;
      onAddTime?: AddTimeHandler;
      onSessionEnded?: VoidHandler;
      onSessionExpired?: VoidHandler;
      onForceLock?: VoidHandler;
    }
  ): void {
    this.disconnect();

    const wsUrl = toWsUrl(serverUrl);

    this.socket = io(wsUrl, {
      auth: { computerId, authSecret },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this.socket.on('connect', () => {
      this.reconnectAttempt = 0;
      handlers.onConnect?.();
    });

    this.socket.on('disconnect', () => {
      handlers.onDisconnect?.();
    });

    this.socket.io.on('reconnect_attempt', () => {
      this.reconnectAttempt += 1;
    });

    this.socket.on(WsEvents.START_SESSION, (payload: StartSessionPayload) => {
      handlers.onStartSession?.(payload);
    });

    this.socket.on(WsEvents.ADD_TIME, (payload: AddTimePayload) => {
      handlers.onAddTime?.(payload);
    });

    this.socket.on(WsEvents.SESSION_ENDED, (payload) => {
      handlers.onSessionEnded?.(payload);
    });

    this.socket.on(WsEvents.SESSION_EXPIRED, (payload) => {
      handlers.onSessionExpired?.(payload);
    });

    this.socket.on(WsEvents.FORCE_LOCK, (payload) => {
      handlers.onForceLock?.(payload);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  sendHeartbeat(): void {
    this.socket?.emit(WsEvents.HEARTBEAT);
  }
}

export const socketClient = new SocketClient();
