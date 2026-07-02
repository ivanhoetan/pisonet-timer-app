import { Router, type Response } from 'express';
import {
  registerSchema,
  loginSchema,
  pinLoginSchema,
  passwordLoginSchema,
  pinLogoutSchema,
  adminLoginSchema,
  changePasswordSchema,
} from '@pisonet/shared';
import { User } from '../models/User';
import { Admin } from '../models/Admin';
import { Computer } from '../models/Computer';
import { hashSecret, compareSecret } from '../utils/crypto';
import { signToken } from '../utils/jwt';
import { validateBody } from '../middleware/validate';
import { sessionEngine } from '../services/sessionEngine';
import { authMiddleware, userMiddleware, type AuthRequest } from '../middleware/auth';
import { recordSystemAudit } from '../services/audit';
import {
  adminAccountKey,
  clearLoginLockout,
  getLoginLockout,
  lockoutMessage,
  MAX_FAILED_LOGIN_ATTEMPTS,
  recordFailedLogin,
  userAccountKey,
} from '../services/loginLockout';

export const authRouter = Router();

async function isUserLocked(username: string, res: Response): Promise<boolean> {
  const status = await getLoginLockout(userAccountKey(username));
  if (status.locked) {
    res.status(429).json({ error: lockoutMessage(status.retryAfterMs) });
    return true;
  }
  return false;
}

async function isAdminLocked(email: string, res: Response): Promise<boolean> {
  const status = await getLoginLockout(adminAccountKey(email));
  if (status.locked) {
    res.status(429).json({ error: lockoutMessage(status.retryAfterMs) });
    return true;
  }
  return false;
}

async function rejectUserLogin(
  username: string,
  res: Response,
  details?: string
): Promise<void> {
  const result = await recordFailedLogin(userAccountKey(username));
  recordSystemAudit({
    actorEmail: username,
    action: 'login_failed',
    targetType: 'user',
    targetLabel: username,
    details:
      details ||
      `Wrong password (${result.attempts}/${MAX_FAILED_LOGIN_ATTEMPTS} attempts)`,
  });
  if (result.locked) {
    res.status(429).json({ error: lockoutMessage(result.retryAfterMs) });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
}

async function rejectAdminLogin(
  email: string,
  res: Response,
  details?: string
): Promise<void> {
  const result = await recordFailedLogin(adminAccountKey(email));
  recordSystemAudit({
    actorEmail: email,
    action: 'login_failed',
    targetType: 'admin',
    targetLabel: email,
    details:
      details ||
      `Wrong password (${result.attempts}/${MAX_FAILED_LOGIN_ATTEMPTS} attempts)`,
  });
  if (result.locked) {
    res.status(429).json({ error: lockoutMessage(result.retryAfterMs) });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
}

authRouter.post('/register', validateBody(registerSchema), async (req, res) => {
  try {
    const { username, nickname, password, pin, mobileNumber } = req.body;

    const existing = await User.findOne({ username });
    if (existing) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }

    const user = await User.create({
      username,
      nickname: nickname?.trim() || undefined,
      passwordHash: await hashSecret(password),
      pinHash: pin ? await hashSecret(pin) : undefined,
      mobileNumber,
      balanceSeconds: 0,
    });

    const token = signToken({ sub: user._id.toString(), role: 'user', username: user.username });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        balanceSeconds: user.balanceSeconds,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res) => {
  try {
    const { username, password } = req.body;
    const trimmed = username.trim();

    if (await isUserLocked(trimmed, res)) return;

    const user = await User.findOne({ username: trimmed });

    if (!user || user.status !== 'active') {
      await rejectUserLogin(trimmed, res);
      return;
    }

    const valid = await compareSecret(password, user.passwordHash);
    if (!valid) {
      await rejectUserLogin(trimmed, res);
      return;
    }

    await clearLoginLockout(userAccountKey(trimmed));

    const token = signToken({ sub: user._id.toString(), role: 'user', username: user.username });

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        balanceSeconds: user.balanceSeconds,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

authRouter.post('/pin-login', validateBody(pinLoginSchema), async (req, res) => {
  const trimmed = String(req.body.username ?? '').trim();
  try {
    const { pin, computerId } = req.body;

    if (await isUserLocked(trimmed, res)) return;

    const user = await User.findOne({ username: trimmed });
    if (!user || user.status !== 'active' || !user.pinHash) {
      await rejectUserLogin(trimmed, res, 'Wrong PIN');
      return;
    }

    const validPin = await compareSecret(pin, user.pinHash);
    if (!validPin) {
      await rejectUserLogin(trimmed, res, 'Wrong PIN');
      return;
    }

    const computer = await Computer.findById(computerId);
    if (!computer) {
      res.status(404).json({ error: 'Computer not found' });
      return;
    }

    if (user.balanceSeconds <= 0) {
      await clearLoginLockout(userAccountKey(trimmed));
      res.status(402).json({ error: 'Insufficient balance' });
      return;
    }

    const { session, remainingSeconds } = await sessionEngine.startSession({
      userId: user._id.toString(),
      username: user.username,
      computerId,
      balanceSeconds: user.balanceSeconds,
      loyaltyStamps: user.loyaltyStamps,
    });

    await clearLoginLockout(userAccountKey(trimmed));

    const token = signToken({ sub: user._id.toString(), role: 'user', username: user.username });

    res.json({
      token,
      sessionId: session._id,
      remainingSeconds,
      username: user.username,
      loyaltyStamps: user.loyaltyStamps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    const status = message.includes('already') || message.includes('in use') ? 409 : 400;
    if (status === 409) {
      await clearLoginLockout(userAccountKey(trimmed));
    }
    res.status(status).json({ error: message });
  }
});

// Password-based session login for the kiosk. Stronger than the 4–6 digit PIN.
authRouter.post('/password-login', validateBody(passwordLoginSchema), async (req, res) => {
  const trimmed = String(req.body.username ?? '').trim();
  try {
    const { password, computerId } = req.body;

    if (await isUserLocked(trimmed, res)) return;

    const user = await User.findOne({ username: trimmed });
    if (!user || user.status !== 'active') {
      await rejectUserLogin(trimmed, res);
      return;
    }

    const validPassword = await compareSecret(password, user.passwordHash);
    if (!validPassword) {
      await rejectUserLogin(trimmed, res);
      return;
    }

    const computer = await Computer.findById(computerId);
    if (!computer) {
      res.status(404).json({ error: 'Computer not found' });
      return;
    }

    if (user.balanceSeconds <= 0) {
      await clearLoginLockout(userAccountKey(trimmed));
      res.status(402).json({ error: 'Insufficient balance' });
      return;
    }

    const { session, remainingSeconds } = await sessionEngine.startSession({
      userId: user._id.toString(),
      username: user.username,
      computerId,
      balanceSeconds: user.balanceSeconds,
      loyaltyStamps: user.loyaltyStamps,
    });

    await clearLoginLockout(userAccountKey(trimmed));

    const token = signToken({ sub: user._id.toString(), role: 'user', username: user.username });

    res.json({
      token,
      sessionId: session._id,
      remainingSeconds,
      username: user.username,
      loyaltyStamps: user.loyaltyStamps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    const status = message.includes('already') || message.includes('in use') ? 409 : 400;
    if (status === 409) {
      await clearLoginLockout(userAccountKey(trimmed));
    }
    res.status(status).json({ error: message });
  }
});

authRouter.post('/pin-logout', validateBody(pinLogoutSchema), async (req, res) => {
  try {
    const { username, pin, computerId } = req.body;

    const user = await User.findOne({ username });
    if (!user || user.status !== 'active' || !user.pinHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const validPin = await compareSecret(pin, user.pinHash);
    if (!validPin) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const result = await sessionEngine.pauseUserOnComputer(user._id.toString(), computerId);
    if (!result) {
      res.json({ remainingSeconds: user.balanceSeconds });
      return;
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Logout failed';
    res.status(400).json({ error: message });
  }
});

authRouter.post(
  '/change-password',
  authMiddleware,
  userMiddleware,
  validateBody(changePasswordSchema),
  async (req: AuthRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      const user = await User.findById(req.auth!.sub);
      if (!user || user.status !== 'active') {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const valid = await compareSecret(currentPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }

      user.passwordHash = await hashSecret(newPassword);
      await user.save();

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

authRouter.post('/admin/login', validateBody(adminLoginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const trimmed = email.trim().toLowerCase();

    if (await isAdminLocked(trimmed, res)) return;

    const admin = await Admin.findOne({
      email: {
        $regex: new RegExp(
          `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
          'i'
        ),
      },
    });

    if (!admin) {
      await rejectAdminLogin(trimmed, res);
      return;
    }

    const valid = await compareSecret(password, admin.passwordHash);
    if (!valid) {
      await rejectAdminLogin(trimmed, res);
      return;
    }

    await clearLoginLockout(adminAccountKey(trimmed));

    const token = signToken({ sub: admin._id.toString(), role: 'admin', email: admin.email });

    res.json({ token, admin: { id: admin._id, email: admin.email, role: admin.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Admin login failed' });
  }
});
