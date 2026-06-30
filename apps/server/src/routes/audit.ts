import { Router } from 'express';
import { AuditLog } from '../models/AuditLog';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

export const auditRouter = Router();

auditRouter.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const filter = action ? { action } : {};

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(5, parseInt(String(req.query.pageSize ?? '25'), 10) || 25)
    );

    const total = await AuditLog.countDocuments(filter);
    const items = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    res.json({ items, total, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});
