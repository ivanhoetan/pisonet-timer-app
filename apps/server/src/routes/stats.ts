import { Router } from 'express';
import { PESOS_PER_STAMP, STAMPS_PER_REWARD, REWARD_MINUTES } from '@pisonet/shared';
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

// Loyalty report: stamps earned and rewards/points redeemed over a date range.
// Activity is derived from transactions so it stays consistent with the accrual
// rules (1 stamp per full ₱12 in a single paid top-up; redemptions are the
// 'loyalty' payment method). Also returns a current outstanding snapshot.
statsRouter.get('/loyalty', authMiddleware, adminMiddleware, async (req, res) => {
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

    const [transactions, outstanding] = await Promise.all([
      Transaction.find({ createdAt: range })
        .populate('userId', 'username')
        .sort({ createdAt: 1 })
        .lean(),
      User.aggregate<{
        _id: null;
        totalStamps: number;
        totalPoints: number;
        usersWithStamps: number;
      }>([
        {
          $group: {
            _id: null,
            totalStamps: { $sum: '$loyaltyStamps' },
            totalPoints: { $sum: '$points' },
            usersWithStamps: {
              $sum: { $cond: [{ $gt: ['$loyaltyStamps', 0] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    let stampsEarned = 0;
    let stampsRedeemed = 0;
    let rewardsRedeemed = 0;
    let pointsAwarded = 0;
    let earnEventCount = 0;
    let redeemEventCount = 0;

    const userMap = new Map<
      string,
      { username: string; stampsEarned: number; stampsRedeemed: number; rewardsRedeemed: number }
    >();

    const events: Array<{
      createdAt: Date;
      username: string;
      type: 'earn' | 'redeem';
      stamps: number;
      rewards: number;
      minutes: number;
    }> = [];

    for (const t of transactions) {
      const user = t.userId as unknown as { _id?: unknown; username?: string } | null;
      const username = user?.username || 'unknown';
      const userId = user?._id ? String(user._id) : username;

      const bucket =
        userMap.get(userId) ||
        { username, stampsEarned: 0, stampsRedeemed: 0, rewardsRedeemed: 0 };

      if (t.paymentMethod === 'loyalty' && (t.minutesAdded || 0) > 0) {
        const rewards = Math.round((t.minutesAdded || 0) / REWARD_MINUTES);
        const stamps = rewards * STAMPS_PER_REWARD;
        rewardsRedeemed += rewards;
        stampsRedeemed += stamps;
        pointsAwarded += rewards;
        redeemEventCount += 1;
        bucket.stampsRedeemed += stamps;
        bucket.rewardsRedeemed += rewards;
        events.push({
          createdAt: t.createdAt,
          username,
          type: 'redeem',
          stamps,
          rewards,
          minutes: t.minutesAdded || 0,
        });
      } else if ((t.amountPaid || 0) > 0) {
        const stamps = Math.floor((t.amountPaid || 0) / PESOS_PER_STAMP);
        if (stamps > 0) {
          stampsEarned += stamps;
          earnEventCount += 1;
          bucket.stampsEarned += stamps;
          events.push({
            createdAt: t.createdAt,
            username,
            type: 'earn',
            stamps,
            rewards: 0,
            minutes: t.minutesAdded || 0,
          });
        }
      }

      userMap.set(userId, bucket);
    }

    const byUser = Array.from(userMap.values())
      .filter((u) => u.stampsEarned > 0 || u.stampsRedeemed > 0)
      .sort((a, b) => b.stampsEarned - a.stampsEarned || b.stampsRedeemed - a.stampsRedeemed);

    const snapshot = outstanding[0] || {
      totalStamps: 0,
      totalPoints: 0,
      usersWithStamps: 0,
    };

    res.json({
      start: start.toISOString(),
      end: end.toISOString(),
      summary: {
        stampsEarned,
        stampsRedeemed,
        rewardsRedeemed,
        pointsAwarded,
        earnEventCount,
        redeemEventCount,
      },
      outstanding: {
        totalStamps: snapshot.totalStamps || 0,
        totalPoints: snapshot.totalPoints || 0,
        usersWithStamps: snapshot.usersWithStamps || 0,
        redeemableRewards: Math.floor((snapshot.totalStamps || 0) / STAMPS_PER_REWARD),
      },
      byUser,
      events,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build loyalty report' });
  }
});
