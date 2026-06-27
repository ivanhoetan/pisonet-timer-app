import { Router } from 'express';
import { registerComputerSchema, heartbeatSchema, endComputerSessionSchema } from '@pisonet/shared';
import { Computer } from '../models/Computer';
import { generateAuthSecret } from '../utils/crypto';
import { validateBody } from '../middleware/validate';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';
import { recordAudit } from '../services/audit';

export const computersRouter = Router();

computersRouter.post(
  '/register',
  authMiddleware,
  adminMiddleware,
  validateBody(registerComputerSchema),
  async (req, res) => {
    try {
      const { computerCode, name } = req.body;

      const existing = await Computer.findOne({ computerCode });
      if (existing) {
        res.status(409).json({ error: 'Computer code already exists' });
        return;
      }

      const authSecret = generateAuthSecret();
      const computer = await Computer.create({
        computerCode,
        name,
        authSecret,
        status: 'OFFLINE',
      });

      recordAudit(req as AuthRequest, {
        action: 'computer_register',
        targetType: 'computer',
        targetId: computer._id.toString(),
        targetLabel: computer.computerCode,
      });

      res.status(201).json({
        id: computer._id,
        computerCode: computer.computerCode,
        name: computer.name,
        authSecret,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to register computer' });
    }
  }
);

computersRouter.get('/', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const computers = await Computer.find().select('-authSecret').sort({ computerCode: 1 });
    res.json(computers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list computers' });
  }
});

computersRouter.post('/heartbeat', validateBody(heartbeatSchema), async (req, res) => {
  try {
    const { computerId } = req.body;
    const computer = await Computer.findByIdAndUpdate(
      computerId,
      { lastOnline: new Date(), status: 'ONLINE' },
      { new: true }
    );

    if (!computer) {
      res.status(404).json({ error: 'Computer not found' });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

computersRouter.post(
  '/end-session',
  validateBody(endComputerSessionSchema),
  async (req, res) => {
    try {
      const { computerId, authSecret, sessionId } = req.body;
      const computer = await Computer.findById(computerId);

      if (!computer || computer.authSecret !== authSecret) {
        res.status(401).json({ error: 'Invalid computer credentials' });
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

computersRouter.post(
  '/:id/lock',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const computer = await Computer.findById(req.params.id);
      if (!computer) {
        res.status(404).json({ error: 'Computer not found' });
        return;
      }

      await sessionEngine.forceLock(computer._id.toString(), 'admin_lock');

      recordAudit(req as AuthRequest, {
        action: 'computer_lock',
        targetType: 'computer',
        targetId: computer._id.toString(),
        targetLabel: computer.computerCode,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to lock computer' });
    }
  }
);

computersRouter.post(
  '/:id/shutdown',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const computer = await Computer.findById(req.params.id);
      if (!computer) {
        res.status(404).json({ error: 'Computer not found' });
        return;
      }

      await sessionEngine.shutdownComputer(computer._id.toString(), 'admin_shutdown');

      recordAudit(req as AuthRequest, {
        action: 'computer_shutdown',
        targetType: 'computer',
        targetId: computer._id.toString(),
        targetLabel: computer.computerCode,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to shut down computer' });
    }
  }
);
