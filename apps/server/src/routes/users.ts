import { Router } from 'express';
import { adminCreateUserSchema, adminUpdateUserSchema } from '@pisonet/shared';
import { User, IUser } from '../models/User';
import { hashSecret } from '../utils/crypto';
import { validateBody } from '../middleware/validate';
import { authMiddleware, adminMiddleware, userMiddleware, AuthRequest } from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';
import { recordAudit } from '../services/audit';

export const usersRouter = Router();

function serializeUser(user: IUser) {
  const active = sessionEngine.getByUserId(user._id.toString());
  return {
    id: user._id,
    username: user.username,
    balanceSeconds: user.balanceSeconds,
    mobileNumber: user.mobileNumber,
    status: user.status,
    createdAt: user.createdAt,
    activeSession: active
      ? {
          sessionId: active.sessionId,
          computerId: active.computerId,
          remainingSeconds: sessionEngine.getRemainingSeconds(active),
        }
      : null,
  };
}

usersRouter.get('/me', authMiddleware, userMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.auth!.sub).select('-passwordHash -pinHash');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user._id,
      username: user.username,
      balanceSeconds: user.balanceSeconds,
      mobileNumber: user.mobileNumber,
      status: user.status,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

usersRouter.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const filter = search
      ? { username: { $regex: search, $options: 'i' } }
      : {};

    const users = await User.find(filter)
      .select('-passwordHash -pinHash')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json(users.map(serializeUser));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

usersRouter.post(
  '/',
  authMiddleware,
  adminMiddleware,
  validateBody(adminCreateUserSchema),
  async (req, res) => {
    try {
      const { username, password, pin, mobileNumber, initialMinutes } = req.body;

      const existing = await User.findOne({ username });
      if (existing) {
        res.status(409).json({ error: 'Username already taken' });
        return;
      }

      const user = await User.create({
        username,
        passwordHash: await hashSecret(password),
        pinHash: await hashSecret(pin),
        mobileNumber,
        balanceSeconds: (initialMinutes ?? 0) * 60,
      });

      recordAudit(req as AuthRequest, {
        action: 'user_create',
        targetType: 'user',
        targetId: user._id.toString(),
        targetLabel: user.username,
        details: initialMinutes ? `starting ${initialMinutes} min` : undefined,
      });

      res.status(201).json(serializeUser(user));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

usersRouter.get('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash -pinHash');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(serializeUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

usersRouter.patch(
  '/:id',
  authMiddleware,
  adminMiddleware,
  validateBody(adminUpdateUserSchema),
  async (req, res) => {
    try {
      const { username, password, pin, mobileNumber, status } = req.body;

      const user = await User.findById(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (username && username !== user.username) {
        const clash = await User.findOne({ username });
        if (clash) {
          res.status(409).json({ error: 'Username already taken' });
          return;
        }
        user.username = username;
      }

      const changes: string[] = [];
      if (username) changes.push('username');
      if (password) {
        user.passwordHash = await hashSecret(password);
        changes.push('password');
      }
      if (pin) {
        user.pinHash = await hashSecret(pin);
        changes.push('pin');
      }
      if (mobileNumber !== undefined) {
        user.mobileNumber = mobileNumber;
        changes.push('mobile');
      }
      if (status) {
        user.status = status;
        changes.push(`status=${status}`);
      }

      await user.save();

      recordAudit(req as AuthRequest, {
        action: 'user_update',
        targetType: 'user',
        targetId: user._id.toString(),
        targetLabel: user.username,
        details: changes.length ? `changed ${changes.join(', ')}` : undefined,
      });

      res.json(serializeUser(user));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);
