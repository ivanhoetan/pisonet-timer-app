import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  registerComputerSchema,
  heartbeatSchema,
  endComputerSessionSchema,
  maintenanceSchema,
  claimComputerSchema,
} from '@pisonet/shared';
import { Computer } from '../models/Computer';
import { generateAuthSecret, generatePairingCode, PAIRING_CODE_TTL_MS } from '../utils/crypto';
import { validateBody } from '../middleware/validate';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';
import { recordAudit } from '../services/audit';

export const computersRouter = Router();

// Guards the public claim endpoint against brute-forcing short pairing codes.
const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

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
      const pairingCode = generatePairingCode();
      const pairingCodeExpires = new Date(Date.now() + PAIRING_CODE_TTL_MS);
      const computer = await Computer.create({
        computerCode,
        name,
        authSecret,
        status: 'OFFLINE',
        pairingCode,
        pairingCodeExpires,
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
        pairingCode,
        pairingCodeExpires,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to register computer' });
    }
  }
);

// Generate a fresh quick-pair code for an existing computer (e.g. re-pairing or
// if the auth secret was lost). Admin-only.
computersRouter.post(
  '/:id/pairing-code',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const computer = await Computer.findById(req.params.id);
      if (!computer) {
        res.status(404).json({ error: 'Computer not found' });
        return;
      }

      computer.pairingCode = generatePairingCode();
      computer.pairingCodeExpires = new Date(Date.now() + PAIRING_CODE_TTL_MS);
      await computer.save();

      recordAudit(req as AuthRequest, {
        action: 'computer_pairing_code',
        targetType: 'computer',
        targetId: computer._id.toString(),
        targetLabel: computer.computerCode,
      });

      res.json({
        id: computer._id,
        computerCode: computer.computerCode,
        name: computer.name,
        pairingCode: computer.pairingCode,
        pairingCodeExpires: computer.pairingCodeExpires,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to generate pairing code' });
    }
  }
);

// Public quick-pair: the client redeems a short code for its credentials.
// Single-use — the code is cleared once redeemed.
computersRouter.post(
  '/claim',
  claimLimiter,
  validateBody(claimComputerSchema),
  async (req, res) => {
    try {
      // Accept the code with or without its hyphen/spaces, then rebuild the
      // canonical "XXX-XXX" form used in storage.
      let code = String(req.body.code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length === 6) code = `${code.slice(0, 3)}-${code.slice(3)}`;
      const computer = await Computer.findOne({ pairingCode: code });

      if (
        !computer ||
        !computer.pairingCodeExpires ||
        computer.pairingCodeExpires.getTime() < Date.now()
      ) {
        res.status(404).json({ error: 'Invalid or expired pairing code' });
        return;
      }

      computer.pairingCode = undefined;
      computer.pairingCodeExpires = undefined;
      await computer.save();

      res.json({
        computerId: computer._id,
        authSecret: computer.authSecret,
        computerCode: computer.computerCode,
        name: computer.name,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to claim pairing code' });
    }
  }
);

computersRouter.get('/', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const computers = await Computer.find()
      .select('-authSecret -pairingCode -pairingCodeExpires')
      .sort({ computerCode: 1 });
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

computersRouter.post(
  '/:id/maintenance',
  authMiddleware,
  adminMiddleware,
  validateBody(maintenanceSchema),
  async (req, res) => {
    try {
      const computer = await Computer.findById(req.params.id);
      if (!computer) {
        res.status(404).json({ error: 'Computer not found' });
        return;
      }

      const { enabled } = req.body as { enabled: boolean };
      await sessionEngine.setMaintenance(computer._id.toString(), enabled);

      recordAudit(req as AuthRequest, {
        action: enabled ? 'computer_maintenance_on' : 'computer_maintenance_off',
        targetType: 'computer',
        targetId: computer._id.toString(),
        targetLabel: computer.computerCode,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to set maintenance mode' });
    }
  }
);
