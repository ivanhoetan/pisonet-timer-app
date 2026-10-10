import { Types } from 'mongoose';
import {
  SessionLog,
  type SessionLogAction,
  type SessionLogReason,
} from '../models/SessionLog';

export interface SessionLogInput {
  userId: string;
  username: string;
  computerId: string;
  action: SessionLogAction;
  reason: SessionLogReason;
  remainingSeconds: number;
}

// Fire-and-forget. A log write must not fail a customer login or logout.
export function recordSessionLog(input: SessionLogInput): void {
  if (!Types.ObjectId.isValid(input.userId) || !Types.ObjectId.isValid(input.computerId)) {
    console.error('Skipped session log: invalid user or computer id');
    return;
  }

  SessionLog.create({
    userId: new Types.ObjectId(input.userId),
    username: input.username,
    computerId: new Types.ObjectId(input.computerId),
    action: input.action,
    reason: input.reason,
    remainingSeconds: Math.max(0, Math.floor(input.remainingSeconds)),
  }).catch((err) => {
    console.error('Failed to write session log', err);
  });
}
