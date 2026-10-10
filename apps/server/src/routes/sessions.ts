import { Router } from 'express';
import { endSessionSchema } from '@pisonet/shared';
import { Session } from '../models/Session';
import { SessionLog, SessionLogAction } from '../models/SessionLog';
import { Computer } from '../models/Computer';
import { validateBody } from '../middleware/validate';
import {
  authMiddleware,
  adminMiddleware,
  userMiddleware,
  AuthRequest,
} from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';

export const sessionsRouter = Router();

sessionsRouter.post(
  '/end',
  authMiddleware,
  userMiddleware,
  validateBody(endSessionSchema),
  async (req: AuthRequest, res) => {
    try {
      const { sessionId } = req.body;
      const session = await Session.findById(sessionId);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (session.userId.toString() !== req.auth!.sub) {
        res.status(403).json({ error: 'Not your session' });
        return;
      }

      const result = await sessionEngine.pauseSession(sessionId);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to end session';
      res.status(400).json({ error: message });
    }
  }
);

sessionsRouter.get('/active', authMiddleware, userMiddleware, async (req: AuthRequest, res) => {
  const active = sessionEngine.getByUserId(req.auth!.sub);
  if (!active) {
    res.json({ active: false });
    return;
  }

  res.json({
    active: true,
    sessionId: active.sessionId,
    computerId: active.computerId,
    remainingSeconds: sessionEngine.getRemainingSeconds(active),
  });
});

sessionsRouter.get('/live', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const active = sessionEngine.listActive();
    const computers = await Computer.find().select('computerCode name').lean();
    const codeById = new Map(
      computers.map((c) => [c._id.toString(), c.computerCode || c.name])
    );

    res.json(
      active.map((s) => ({
        sessionId: s.sessionId,
        userId: s.userId,
        username: s.username,
        computerId: s.computerId,
        computerCode: codeById.get(s.computerId) || s.computerId,
        remainingSeconds: s.remainingSeconds,
        startedAt: s.startedAt,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list active sessions' });
  }
});

sessionsRouter.get('/logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(5, parseInt(String(req.query.pageSize ?? '25'), 10) || 25)
    );

    const action = typeof req.query.action === 'string' ? req.query.action : '';
    const filter: Record<string, unknown> = {};
    if (action === SessionLogAction.LOGIN || action === SessionLogAction.LOGOUT) {
      filter.action = action;
    }

    const total = await SessionLog.countDocuments(filter);
    const rows = await SessionLog.find(filter)
      .populate('computerId', 'computerCode name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    const items = rows.map((row) => {
      const computer = row.computerId as unknown as {
        computerCode?: string;
        name?: string;
      } | null;
      return {
        _id: row._id,
        username: row.username,
        action: row.action,
        reason: row.reason,
        remainingSeconds: row.remainingSeconds,
        createdAt: row.createdAt,
        computerCode: computer?.computerCode || '',
        computerName: computer?.name || '',
      };
    });

    res.json({ items, total, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list login and logout logs' });
  }
});

sessionsRouter.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const filter =
      req.auth!.role === 'admin'
        ? {}
        : { userId: req.auth!.sub };

    const sessions = await Session.find(filter)
      .populate('userId', 'username')
      .populate('computerId', 'computerCode name')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});
