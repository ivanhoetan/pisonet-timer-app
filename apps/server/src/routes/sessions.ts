import { Router } from 'express';
import { endSessionSchema } from '@pisonet/shared';
import { Session } from '../models/Session';
import { validateBody } from '../middleware/validate';
import { authMiddleware, userMiddleware, AuthRequest } from '../middleware/auth';
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
