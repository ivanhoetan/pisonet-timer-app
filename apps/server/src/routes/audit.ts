import { Router } from 'express';
import { AuditLog } from '../models/AuditLog';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

export const auditRouter = Router();

auditRouter.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const filter = action ? { action } : {};

    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});
