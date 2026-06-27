import { Router } from 'express';
import { User } from '../models/User';
import { Computer } from '../models/Computer';
import { Transaction } from '../models/Transaction';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';

export const statsRouter = Router();

statsRouter.get('/overview', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      disabledUsers,
      computers,
      todayTransactions,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ status: 'disabled' }),
      Computer.find().select('status').lean(),
      Transaction.find({ createdAt: { $gte: startOfToday } })
        .select('minutesAdded amountPaid')
        .lean(),
    ]);

    const computerStatusCounts = computers.reduce(
      (acc, c) => {
        const key = (c.status || 'OFFLINE') as keyof typeof acc;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      { ONLINE: 0, OFFLINE: 0, IN_USE: 0, LOCKED: 0 }
    );

    const minutesSoldToday = todayTransactions.reduce(
      (sum, t) => sum + (t.minutesAdded > 0 ? t.minutesAdded : 0),
      0
    );
    const revenueToday = todayTransactions.reduce(
      (sum, t) => sum + (t.amountPaid && t.amountPaid > 0 ? t.amountPaid : 0),
      0
    );
    const topupsToday = todayTransactions.filter((t) => t.minutesAdded > 0).length;

    res.json({
      users: {
        total: totalUsers,
        active: totalUsers - disabledUsers,
        disabled: disabledUsers,
      },
      computers: {
        total: computers.length,
        online: computerStatusCounts.ONLINE,
        offline: computerStatusCounts.OFFLINE,
        inUse: computerStatusCounts.IN_USE,
        locked: computerStatusCounts.LOCKED,
      },
      activeSessions: sessionEngine.countActive(),
      today: {
        topups: topupsToday,
        minutesSold: minutesSoldToday,
        revenue: revenueToday,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});
