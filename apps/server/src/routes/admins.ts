import { Router } from 'express';
import { adminCreateSchema } from '@pisonet/shared';
import { Admin } from '../models/Admin';
import { hashSecret } from '../utils/crypto';
import { validateBody } from '../middleware/validate';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';
import { recordAudit } from '../services/audit';

export const adminsRouter = Router();

adminsRouter.get('/', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const admins = await Admin.find()
      .select('email role createdAt')
      .sort({ createdAt: 1 })
      .lean();
    res.json(admins);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list admins' });
  }
});

adminsRouter.post(
  '/',
  authMiddleware,
  adminMiddleware,
  validateBody(adminCreateSchema),
  async (req: AuthRequest, res) => {
    try {
      const { email, password, role } = req.body as {
        email: string;
        password: string;
        role?: 'owner' | 'staff';
      };

      const normalizedEmail = email.trim().toLowerCase();
      const existing = await Admin.findOne({ email: normalizedEmail });
      if (existing) {
        res.status(409).json({ error: 'An admin with this email already exists' });
        return;
      }

      const admin = await Admin.create({
        email: normalizedEmail,
        passwordHash: await hashSecret(password),
        role: role || 'staff',
      });

      recordAudit(req, {
        action: 'admin_create',
        targetType: 'admin',
        targetId: admin._id.toString(),
        targetLabel: admin.email,
        details: `role=${admin.role}`,
      });

      res.status(201).json({
        id: admin._id,
        email: admin.email,
        role: admin.role,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create admin' });
    }
  }
);
