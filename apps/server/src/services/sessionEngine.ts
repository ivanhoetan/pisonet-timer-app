import { Types } from 'mongoose';
import { SessionStatus, WsEvents } from '@pisonet/shared';
import { Session, ISession } from '../models/Session';
import { User } from '../models/User';
import { Computer } from '../models/Computer';
import type { Server as SocketServer } from 'socket.io';

export interface ActiveSessionCache {
  sessionId: string;
  userId: string;
  username: string;
  computerId: string;
  startedAt: Date;
  secondsAllocated: number;
  status: SessionStatus;
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
      .populate('userId', 'username')
      .lean();

    this.cache.clear();

    for (const session of activeSessions) {
      const user = session.userId as unknown as { _id: Types.ObjectId; username: string };
      this.cache.set(session._id.toString(), {
        sessionId: session._id.toString(),
        userId: user._id.toString(),
        username: user.username,
        computerId: session.computerId.toString(),
        startedAt: session.startedAt,
        secondsAllocated: session.secondsAllocated,
        status: SessionStatus.ACTIVE,
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

  getByUserId(userId: string): ActiveSessionCache | undefined {
    for (const session of this.cache.values()) {
      if (session.userId === userId && session.status === SessionStatus.ACTIVE) {
        return session;
      }
    }
    return undefined;
  }

  private toCacheEntry(session: ISession, username: string): ActiveSessionCache {
    return {
      sessionId: session._id.toString(),
      userId: session.userId.toString(),
      username,
      computerId: session.computerId.toString(),
      startedAt: session.startedAt,
      secondsAllocated: session.secondsAllocated,
      status: SessionStatus.ACTIVE,
    };
  }

  async startSession(params: {
    userId: string;
    username: string;
    computerId: string;
    balanceSeconds: number;
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
        entry = this.toCacheEntry(existingUserSession, params.username);
        this.cache.set(sessionId, entry);
      }

      const remainingSeconds = this.getRemainingSeconds(entry);

      if (remainingSeconds <= 0) {
        await this.pauseSession(sessionId);
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

    const cacheEntry = this.toCacheEntry(session, params.username);
    this.cache.set(session._id.toString(), cacheEntry);

    await Computer.findByIdAndUpdate(params.computerId, {
      status: 'IN_USE',
      lastOnline: new Date(),
    });

    const remainingSeconds = this.getRemainingSeconds(cacheEntry);
    this.emitStartSession(cacheEntry, remainingSeconds);

    return { session, remainingSeconds };
  }

  private async describeComputer(computerId: string): Promise<string> {
    const computer = await Computer.findById(computerId).select('computerCode name');
    if (!computer) return 'another computer';
    return computer.computerCode || computer.name || 'another computer';
  }

  async pauseSession(sessionId: string): Promise<{ remainingSeconds: number }> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      return this.finalizePause(sessionId, cached);
    }

    const dbSession = await Session.findById(sessionId);
    if (!dbSession || dbSession.status !== SessionStatus.ACTIVE) {
      throw new Error('Session not found or not active');
    }

    const user = await User.findById(dbSession.userId);
    const entry = this.toCacheEntry(dbSession, user?.username || 'user');
    return this.finalizePause(sessionId, entry);
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

  private async finalizePause(
    sessionId: string,
    cached: ActiveSessionCache
  ): Promise<{ remainingSeconds: number }> {
    const remainingSeconds = this.getRemainingSeconds(cached);
    const secondsUsed = cached.secondsAllocated - remainingSeconds;

    const session = await Session.findByIdAndUpdate(
      sessionId,
      {
        status: SessionStatus.PAUSED,
        pausedAt: new Date(),
        secondsUsed,
      },
      { new: true }
    );

    if (!session) {
      throw new Error('Session not found');
    }

    await User.findByIdAndUpdate(cached.userId, {
      $set: { balanceSeconds: remainingSeconds },
    });

    await Computer.findByIdAndUpdate(cached.computerId, { status: 'ONLINE' });

    this.cache.delete(sessionId);
    this.emitSessionEnded(cached.computerId, 'paused');

    return { remainingSeconds };
  }

  async endSession(sessionId: string, markCompleted = false): Promise<{ remainingSeconds: number }> {
    const cached = this.cache.get(sessionId);
    if (!cached) {
      const dbSession = await Session.findById(sessionId);
      if (!dbSession || dbSession.status !== SessionStatus.ACTIVE) {
        throw new Error('Session not found or not active');
      }

      const remaining = Math.max(
        0,
        dbSession.secondsAllocated -
          Math.floor((Date.now() - dbSession.startedAt.getTime()) / 1000)
      );

      await Session.findByIdAndUpdate(sessionId, {
        status: markCompleted ? SessionStatus.COMPLETED : SessionStatus.PAUSED,
        endedAt: new Date(),
        pausedAt: markCompleted ? undefined : new Date(),
        secondsUsed: dbSession.secondsAllocated - remaining,
      });

      await User.findByIdAndUpdate(dbSession.userId, { balanceSeconds: remaining });
      await Computer.findByIdAndUpdate(dbSession.computerId, { status: 'ONLINE' });
      this.emitSessionEnded(dbSession.computerId.toString(), markCompleted ? 'expired' : 'ended');

      return { remainingSeconds: remaining };
    }

    const remainingSeconds = this.getRemainingSeconds(cached);
    const secondsUsed = cached.secondsAllocated - remainingSeconds;

    await Session.findByIdAndUpdate(sessionId, {
      status: markCompleted ? SessionStatus.COMPLETED : SessionStatus.PAUSED,
      endedAt: new Date(),
      pausedAt: markCompleted ? undefined : new Date(),
      secondsUsed,
    });

    await User.findByIdAndUpdate(cached.userId, { balanceSeconds: remainingSeconds });
    await Computer.findByIdAndUpdate(cached.computerId, { status: 'ONLINE' });

    this.cache.delete(sessionId);
    this.emitSessionEnded(
      cached.computerId,
      markCompleted ? 'expired' : 'ended'
    );

    return { remainingSeconds };
  }

  async addTime(sessionId: string, additionalSeconds: number): Promise<number> {
    const cached = this.cache.get(sessionId);
    if (!cached || cached.status !== SessionStatus.ACTIVE) {
      throw new Error('Session not active');
    }

    cached.secondsAllocated += additionalSeconds;

    await Session.findByIdAndUpdate(sessionId, {
      $inc: { secondsAllocated: additionalSeconds },
    });

    const remainingSeconds = this.getRemainingSeconds(cached);
    this.io?.to(`computer:${cached.computerId}`).emit(WsEvents.ADD_TIME, {
      sessionId,
      remainingSeconds,
    });

    return remainingSeconds;
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
        this.io
          ?.to(`computer:${session.computerId}`)
          .emit(WsEvents.SESSION_EXPIRED, { sessionId });

        try {
          await this.endSession(sessionId, true);
        } catch (err) {
          console.error('Failed to expire session', sessionId, err);
        }
      }
    }
  }
}

export const sessionEngine = new SessionEngine();
