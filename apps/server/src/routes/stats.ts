import { Router } from 'express';
import { User } from '../models/User';
import { Computer } from '../models/Computer';
import { Transaction } from '../models/Transaction';
import { Session } from '../models/Session';
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

// End-of-day report. The client sends start/end ISO timestamps for its local
// day so totals match the cafe's timezone regardless of where the server runs.
statsRouter.get('/eod', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setHours(0, 0, 0, 0);

    const start = typeof req.query.start === 'string' ? new Date(req.query.start) : defaultStart;
    const end = typeof req.query.end === 'string' ? new Date(req.query.end) : now;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      res.status(400).json({ error: 'Invalid start/end range' });
      return;
    }

    const range = { $gte: start, $lte: end };

    const [transactions, newUsers, sessionsStarted] = await Promise.all([
      Transaction.find({ createdAt: range })
        .populate('userId', 'username')
        .sort({ createdAt: 1 })
        .lean(),
      User.countDocuments({ createdAt: range }),
      Session.countDocuments({ startedAt: range }),
    ]);

    let revenue = 0;
    let minutesSold = 0;
    let minutesRemoved = 0;
    let topupCount = 0;
    let adjustmentCount = 0;

    const methodMap = new Map<string, { count: number; amount: number; minutes: number }>();

    const rows = transactions.map((t) => {
      const amount = t.amountPaid && t.amountPaid > 0 ? t.amountPaid : 0;
      const minutes = t.minutesAdded || 0;

      if (minutes >= 0) {
        topupCount += 1;
        minutesSold += minutes;
        revenue += amount;
      } else {
        adjustmentCount += 1;
        minutesRemoved += Math.abs(minutes);
      }

      const method = t.paymentMethod || 'manual';
      const bucket = methodMap.get(method) || { count: 0, amount: 0, minutes: 0 };
      bucket.count += 1;
      bucket.amount += amount;
      bucket.minutes += minutes;
      methodMap.set(method, bucket);

      const user = t.userId as unknown as { username?: string } | null;
      return {
        createdAt: t.createdAt,
        username: user?.username || 'unknown',
        minutesAdded: minutes,
        amountPaid: amount,
        paymentMethod: method,
        paymentReference: t.paymentReference || '',
      };
    });

    const byMethod = Array.from(methodMap.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.amount - a.amount);

    res.json({
      start: start.toISOString(),
      end: end.toISOString(),
      summary: {
        revenue,
        minutesSold,
        minutesRemoved,
        topupCount,
        adjustmentCount,
        transactionCount: transactions.length,
        newUsers,
        sessionsStarted,
      },
      byMethod,
      transactions: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build EOD report' });
  }
});
