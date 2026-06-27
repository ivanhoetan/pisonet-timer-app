import { Types } from 'mongoose';
import { AuditLog } from '../models/AuditLog';
import type { AuthRequest } from '../middleware/auth';

export interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  details?: string;
}

// Fire-and-forget audit write. Never throws into the request path.
export function recordAudit(req: AuthRequest, input: AuditInput): void {
  const actorId = req.auth?.sub;
  const actorEmail = req.auth?.email || req.auth?.username || 'unknown';

  AuditLog.create({
    actorId: actorId ? new Types.ObjectId(actorId) : undefined,
    actorEmail,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    details: input.details,
  }).catch((err) => {
    console.error('Failed to write audit log', err);
  });
}
