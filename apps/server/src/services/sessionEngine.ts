import { Types } from 'mongoose';
import { SessionStatus, WsEvents } from '@pisonet/shared';
import { Session, ISession } from '../models/Session';
import { SessionLogReason, type SessionLogReason as SessionEndReason } from '../models/SessionLog';
import { User } from '../models/User';
import { Computer } from '../models/Computer';
import { recordSessionLog } from './sessionLog';
import type { Server as SocketServer } from 'socket.io';

export interface ActiveSessionCache {
  sessionId: string;
  userId: string;
  username: string;
  computerId: string;
  startedAt: Date;
  secondsAllocated: number;
  status: SessionStatus;
  loyaltyStamps: number;
}

export class ActiveSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActiveSessionError';
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

type IoEmitter = Pick<SocketServer, 'to'>;

export class SessionEngine {
  private cache = new Map<string, ActiveSessionCache>();
  private io: IoEmitter | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;

  setIo(io: IoEmitter): void {
    this.io = io;
  }

  async rehydrate(): Promise<void> {
    const activeSessions = await Session.find({ status: SessionStatus.ACTIVE })
      .populate('userId', 'username loyaltyStamps')
      .lean();

    this.cache.clear();

    for (const session of activeSessions) {
      const user = session.userId as unknown as {
        _id: Types.ObjectId;
        username: string;
        loyaltyStamps?: number;
      };
      this.cache.set(session._id.toString(), {
        sessionId: session._id.toString(),
        userId: user._id.toString(),
        username: user.username,
        computerId: session.computerId.toString(),
        startedAt: session.startedAt,
        secondsAllocated: session.secondsAllocated,
        status: SessionStatus.ACTIVE,
        loyaltyStamps: user.loyaltyStamps ?? 0,
      });
    }

    console.log(`Rehydrated ${this.cache.size} active session(s) from MongoDB`);
    this.startExpiryChecker();
  }

  getRemainingSeconds(session: ActiveSessionCache): number {
    const elapsed = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
    return Math.max(0, session.secondsAllocated - elapsed);
  }

  getByComputerId(computerId: string): ActiveSessionCache | undefined {
    for (const session of this.cache.values()) {
      if (session.computerId === computerId && session.status === SessionStatus.ACTIVE) {
        return session;
      }
    }
    return undefined;
  }

  listActive(): Array<ActiveSessionCache & { remainingSeconds: number }> {
    const result: Array<ActiveSessionCache & { remainingSeconds: number }> = [];
    for (const session of this.cache.values()) {
      if (session.status !== SessionStatus.ACTIVE) continue;
      result.push({ ...session, remainingSeconds: this.getRemainingSeconds(session) });
    }
    return result;
  }

  countActive(): number {
    let count = 0;
    for (const session of this.cache.values()) {
      if (session.status === SessionStatus.ACTIVE) count += 1;
    }
    return count;
  }

  getByUserId(userId: string): ActiveSessionCache | undefined {
    for (const session of this.cache.values()) {
      if (session.userId === userId && session.status === SessionStatus.ACTIVE) {
        return session;
      }
    }
    return undefined;
  }

  private toCacheEntry(
    session: ISession,
    username: string,
    loyaltyStamps = 0
  ): ActiveSessionCache {
    return {
      sessionId: session._id.toString(),
      userId: session.userId.toString(),
      username,
      computerId: session.computerId.toString(),
      startedAt: session.startedAt,
      secondsAllocated: session.secondsAllocated,
      status: SessionStatus.ACTIVE,
      loyaltyStamps,
    };
  }

  async startSession(params: {
    userId: string;
    username: string;
    computerId: string;
    balanceSeconds: number;
    loyaltyStamps?: number;
  }): Promise<{ session: ISession; remainingSeconds: number }> {
    const existingUserSession = await Session.findOne({
      userId: params.userId,
      status: SessionStatus.ACTIVE,
    });

    if (existingUserSession) {
      const sessionId = existingUserSession._id.toString();
      const sameComputer = existingUserSession.computerId.toString() === params.computerId;

      let entry = this.cache.get(sessionId);
      if (!entry) {
        entry = this.toCacheEntry(existingUserSession, params.username, params.loyaltyStamps ?? 0);
        this.cache.set(sessionId, entry);
      }

      const remainingSeconds = this.getRemainingSeconds(entry);

      if (remainingSeconds <= 0) {
        // The open session is already finished. Close it and stop. Do not
        // start another one from the balance captured before this close.
        this.cache.delete(sessionId);
        try {
          await this.pauseSession(sessionId, SessionLogReason.EXPIRED);
        } catch (err) {
          const message = err instanceof Error ? err.message : '';
          if (!message.includes('not active')) throw err;
        }
        throw new Error('Insufficient balance');
      } else if (sameComputer) {
        this.emitStartSession(entry, remainingSeconds);
        return { session: existingUserSession, remainingSeconds };
      } else {
        const where = await this.describeComputer(existingUserSession.computerId.toString());
        throw new ActiveSessionError(
          `Account already in use on ${where}. Please log out there first.`
        );
      }
    }

    const existingComputerSession = await Session.findOne({
      computerId: params.computerId,
      status: SessionStatus.ACTIVE,
    });

    if (existingComputerSession) {
      throw new ActiveSessionError('Computer is already in use');
    }

    if (params.balanceSeconds <= 0) {
      throw new Error('Insufficient balance');
    }

    let session: ISession;
    try {
      session = await Session.create({
        userId: new Types.ObjectId(params.userId),
        computerId: new Types.ObjectId(params.computerId),
        status: SessionStatus.ACTIVE,
        startedAt: new Date(),
        secondsAllocated: params.balanceSeconds,
        secondsUsed: 0,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ActiveSessionError(
          'Account or computer already has an active session. Please try again.'
        );
      }
      throw err;
    }

    const cacheEntry = this.toCacheEntry(session, params.username, params.loyaltyStamps ?? 0);
    this.cache.set(session._id.toString(), cacheEntry);

    await Computer.findByIdAndUpdate(params.computerId, {
      status: 'IN_USE',
      lastOnline: new Date(),
    });

    const remainingSeconds = this.getRemainingSeconds(cacheEntry);
    this.emitStartSession(cacheEntry, remainingSeconds);

    recordSessionLog({
      userId: params.userId,
      username: params.username,
      computerId: params.computerId,
      action: 'login',
      reason: SessionLogReason.CUSTOMER,
      remainingSeconds,
    });

    return { session, remainingSeconds };
  }

  private async describeComputer(computerId: string): Promise<string> {
    const computer = await Computer.findById(computerId).select('computerCode name');
    if (!computer) return 'another computer';
    return computer.computerCode || computer.name || 'another computer';
  }

  async pauseSession(
    sessionId: string,
    reason: SessionEndReason = SessionLogReason.CUSTOMER
  ): Promise<{ remainingSeconds: number }> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      return this.finalizePause(sessionId, cached, reason);
    }

    const dbSession = await Session.findById(sessionId);
    if (!dbSession || dbSession.status !== SessionStatus.ACTIVE) {
      throw new Error('Session not found or not active');
    }

    const user = await User.findById(dbSession.userId);
    const entry = this.toCacheEntry(dbSession, user?.username || 'user');
    return this.finalizePause(sessionId, entry, reason);
  }

  async pauseUserOnComputer(
    userId: string,
    computerId: string
  ): Promise<{ remainingSeconds: number } | null> {
    const cached = this.getByUserId(userId);
    if (cached) {
      if (cached.computerId !== computerId) {
        throw new Error('Active session is on another computer');
      }
      return this.pauseSession(cached.sessionId);
    }

    const dbSession = await Session.findOne({
      userId,
      computerId,
      status: SessionStatus.ACTIVE,
    });

    if (!dbSession) {
      return null;
    }

    return this.pauseSession(dbSession._id.toString());
  }

  private async savedBalance(userId: string): Promise<number> {
    const user = await User.findById(userId).select('balanceSeconds');
    return user?.balanceSeconds ?? 0;
  }

  // Only the first closer wins. A logout or a stale in-memory timer cannot
  // overwrite a balance that was already saved.
  private async closeActiveSession(
    sessionId: string,
    cached: ActiveSessionCache,
    reason: SessionEndReason,
    markCompleted: boolean
  ): Promise<{ remainingSeconds: number; closed: boolean }> {
    const remainingSeconds = this.getRemainingSeconds(cached);
    const secondsUsed = cached.secondsAllocated - remainingSeconds;

    const claimed = await Session.findOneAndUpdate(
      { _id: sessionId, status: SessionStatus.ACTIVE },
      markCompleted
        ? {
            status: SessionStatus.COMPLETED,
            endedAt: new Date(),
            secondsUsed,
          }
        : {
            status: SessionStatus.PAUSED,
            pausedAt: new Date(),
            secondsUsed,
          },
      { new: true }
    );

    this.cache.delete(sessionId);

    if (!claimed) {
      return { remainingSeconds: await this.savedBalance(cached.userId), closed: false };
    }

    await User.findByIdAndUpdate(cached.userId, {
      $set: { balanceSeconds: remainingSeconds },
    });

    await Computer.findByIdAndUpdate(cached.computerId, { status: 'ONLINE' });

    this.emitSessionEnded(cached.computerId, markCompleted ? 'expired' : 'paused');

    recordSessionLog({
      userId: cached.userId,
      username: cached.username,
      computerId: cached.computerId,
      action: 'logout',
      reason,
      remainingSeconds,
    });

    return { remainingSeconds, closed: true };
  }

  private async finalizePause(
    sessionId: string,
    cached: ActiveSessionCache,
    reason: SessionEndReason
  ): Promise<{ remainingSeconds: number }> {
    return this.closeActiveSession(sessionId, cached, reason, false);
  }

  async endSession(
    sessionId: string,
    markCompleted = false
  ): Promise<{ remainingSeconds: number; closed: boolean }> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      return this.closeActiveSession(
        sessionId,
        cached,
        markCompleted ? SessionLogReason.EXPIRED : SessionLogReason.CUSTOMER,
        markCompleted
      );
    }

    const dbSession = await Session.findById(sessionId);
    if (!dbSession || dbSession.status !== SessionStatus.ACTIVE) {
      this.cache.delete(sessionId);
      throw new Error('Session not found or not active');
    }

    const user = await User.findById(dbSession.userId).select('username');
    const entry = this.toCacheEntry(dbSession, user?.username || 'user');
    return this.closeActiveSession(
      sessionId,
      entry,
      markCompleted ? SessionLogReason.EXPIRED : SessionLogReason.CUSTOMER,
      markCompleted
    );
  }

  async addTime(sessionId: string, additionalSeconds: number): Promise<number> {
    const cached = this.cache.get(sessionId);
    if (!cached || cached.status !== SessionStatus.ACTIVE) {
      throw new Error('Session not active');
    }

    const updated = await Session.findOneAndUpdate(
      { _id: sessionId, status: SessionStatus.ACTIVE },
      { $inc: { secondsAllocated: additionalSeconds } },
      { new: true }
    );
    if (!updated) {
      this.cache.delete(sessionId);
      throw new Error('Session not active');
    }

    cached.secondsAllocated += additionalSeconds;

    const remainingSeconds = this.getRemainingSeconds(cached);
    this.io?.to(`computer:${cached.computerId}`).emit(WsEvents.ADD_TIME, {
      sessionId,
      remainingSeconds,
    });

    return remainingSeconds;
  }

  async subtractTime(sessionId: string, secondsToRemove: number): Promise<number> {
    if (secondsToRemove <= 0) {
      throw new Error('secondsToRemove must be positive');
    }

    const cached = this.cache.get(sessionId);
    if (!cached || cached.status !== SessionStatus.ACTIVE) {
      throw new Error('Session not active');
    }

    const available = this.getRemainingSeconds(cached);
    if (secondsToRemove > available) {
      throw new Error('Cannot remove more than remaining session time');
    }

    const remainingSeconds = await this.addTime(sessionId, -secondsToRemove);
    if (remainingSeconds <= 0) {
      await this.endSession(sessionId, true);
      return 0;
    }

    return remainingSeconds;
  }

  async forceLock(computerId: string, reason = 'admin_lock'): Promise<void> {
    const active = this.getByComputerId(computerId);
    if (active) {
      // pauseSession saves remaining time and emits SESSION_ENDED + FORCE_LOCK.
      await this.pauseSession(active.sessionId, SessionLogReason.STAFF);
    } else {
      this.io?.to(`computer:${computerId}`).emit(WsEvents.FORCE_LOCK, { reason });
    }

    await Computer.findByIdAndUpdate(computerId, { status: 'LOCKED' });
  }

  async setMaintenance(computerId: string, enabled: boolean): Promise<void> {
    if (enabled) {
      // Free access for servicing: end any paid session (time saved) first.
      const active = this.getByComputerId(computerId);
      if (active) {
        await this.pauseSession(active.sessionId, SessionLogReason.STAFF);
      }
      await Computer.findByIdAndUpdate(computerId, { status: 'MAINTENANCE' });
      this.io?.to(`computer:${computerId}`).emit(WsEvents.MAINTENANCE_MODE, { enabled: true });
    } else {
      await Computer.findByIdAndUpdate(computerId, { status: 'ONLINE' });
      this.io?.to(`computer:${computerId}`).emit(WsEvents.MAINTENANCE_MODE, { enabled: false });
    }
  }

  async shutdownComputer(computerId: string, reason = 'admin_shutdown'): Promise<void> {
    const active = this.getByComputerId(computerId);
    if (active) {
      await this.pauseSession(active.sessionId, SessionLogReason.STAFF);
    }

    await Computer.findByIdAndUpdate(computerId, { status: 'LOCKED' });
    this.io?.to(`computer:${computerId}`).emit(WsEvents.SHUTDOWN, { reason });
  }

  resyncComputer(computerId: string): void {
    const session = this.getByComputerId(computerId);
    if (!session) return;

    const remainingSeconds = this.getRemainingSeconds(session);
    this.emitStartSession(session, remainingSeconds);
  }

  private emitStartSession(session: ActiveSessionCache, remainingSeconds: number): void {
    this.io?.to(`computer:${session.computerId}`).emit(WsEvents.START_SESSION, {
      sessionId: session.sessionId,
      userId: session.userId,
      username: session.username,
      remainingSeconds,
      startedAt: session.startedAt.toISOString(),
      loyaltyStamps: session.loyaltyStamps,
    });
  }

  private emitSessionEnded(computerId: string, reason: string): void {
    this.io?.to(`computer:${computerId}`).emit(WsEvents.SESSION_ENDED, { reason });
    this.io?.to(`computer:${computerId}`).emit(WsEvents.FORCE_LOCK, { reason });
  }

  private startExpiryChecker(): void {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
    }

    this.expiryTimer = setInterval(() => {
      void this.checkExpiredSessions();
    }, 5000);
  }

  private async checkExpiredSessions(): Promise<void> {
    for (const [sessionId, session] of this.cache.entries()) {
      if (session.status !== SessionStatus.ACTIVE) continue;

      const remaining = this.getRemainingSeconds(session);
      if (remaining <= 0) {
        try {
          const result = await this.endSession(sessionId, true);
          if (!result.closed) continue;
          this.io
            ?.to(`computer:${session.computerId}`)
            .emit(WsEvents.SESSION_EXPIRED, { sessionId });
        } catch (err) {
          this.cache.delete(sessionId);
          console.error('Failed to expire session', sessionId, err);
        }
      }
    }
  }
}

export const sessionEngine = new SessionEngine();
