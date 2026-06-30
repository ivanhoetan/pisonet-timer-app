import { Router } from 'express';
import {
  adjustTimeSchema,
  createTransactionSchema,
  pesosToMinutes,
  PESOS_PER_STAMP,
} from '@pisonet/shared';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import { validateBody } from '../middleware/validate';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';
import { recordAudit } from '../services/audit';

export const transactionsRouter = Router();

transactionsRouter.post(
  '/',
  authMiddleware,
  adminMiddleware,
  validateBody(createTransactionSchema),
  async (req: AuthRequest, res) => {
    try {
      const { userId, pesos, minutesAdded: rawMinutes, paymentMethod, paymentReference } = req.body;

      // Peso-charged top-up derives minutes from the rate; a direct minutes
      // grant (no pesos) is treated as free time (revenue = 0).
      const minutesAdded = pesos !== undefined ? pesosToMinutes(pesos) : rawMinutes;
      const amountPaid = pesos !== undefined ? pesos : 0;
      const secondsAdded = minutesAdded * 60;

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      user.balanceSeconds += secondsAdded;

      // Loyalty: a stamp is earned per full PESOS_PER_STAMP within a SINGLE
      // payment only. Leftover pesos do not carry over to future top-ups
      // (e.g. ₱6 earns nothing; one ₱24 payment earns 2 stamps).
      let stampsEarned = 0;
      if (amountPaid > 0) {
        stampsEarned = Math.floor(amountPaid / PESOS_PER_STAMP);
        user.loyaltyStamps += stampsEarned;
      }

      await user.save();

      const transaction = await Transaction.create({
        userId,
        minutesAdded,
        amountPaid,
        paymentMethod,
        paymentReference,
        createdBy: req.auth!.sub,
      });

      const activeSession = sessionEngine.getByUserId(userId);
      if (activeSession) {
        await sessionEngine.addTime(activeSession.sessionId, secondsAdded);
      }

      recordAudit(req, {
        action: 'topup',
        targetType: 'user',
        targetId: userId,
        targetLabel: user.username,
        details:
          amountPaid > 0
            ? `+${minutesAdded} min for \u20b1${amountPaid} (${paymentMethod})` +
              (stampsEarned > 0 ? ` · +${stampsEarned} stamp(s)` : '')
            : `+${minutesAdded} min (free grant)`,
      });

      res.status(201).json({
        transaction,
        newBalanceSeconds: user.balanceSeconds,
        loyaltyStamps: user.loyaltyStamps,
        stampsEarned,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  }
);

transactionsRouter.post(
  '/adjust',
  authMiddleware,
  adminMiddleware,
  validateBody(adjustTimeSchema),
  async (req: AuthRequest, res) => {
    try {
      const { userId, minutesRemoved, reason } = req.body;
      const secondsToRemove = minutesRemoved * 60;

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const activeSession = sessionEngine.getByUserId(userId);
      let newBalanceSeconds: number;

      if (activeSession) {
        const available = sessionEngine.getRemainingSeconds(activeSession);
        if (secondsToRemove > available) {
          const maxMinutes = Math.floor(available / 60);
          res.status(400).json({
            error:
              maxMinutes > 0
                ? `User is online — can remove at most ${maxMinutes} minute(s) right now`
                : 'User has no remaining session time to remove',
          });
          return;
        }

        newBalanceSeconds = await sessionEngine.subtractTime(
          activeSession.sessionId,
          secondsToRemove
        );
        user.balanceSeconds = newBalanceSeconds;
      } else {
        if (secondsToRemove > user.balanceSeconds) {
          const maxMinutes = Math.floor(user.balanceSeconds / 60);
          res.status(400).json({
            error:
              maxMinutes > 0
                ? `Insufficient balance — can remove at most ${maxMinutes} minute(s)`
                : 'User has no time to remove',
          });
          return;
        }

        user.balanceSeconds -= secondsToRemove;
        newBalanceSeconds = user.balanceSeconds;
      }

      await user.save();

      const transaction = await Transaction.create({
        userId,
        minutesAdded: -minutesRemoved,
        amountPaid: 0,
        paymentMethod: 'adjustment',
        paymentReference: reason?.trim() || undefined,
        createdBy: req.auth!.sub,
      });

      recordAudit(req, {
        action: 'time_adjust',
        targetType: 'user',
        targetId: userId,
        targetLabel: user.username,
        details: `-${minutesRemoved} min${reason?.trim() ? ` (${reason.trim()})` : ''}`,
      });

      res.status(201).json({
        transaction,
        newBalanceSeconds,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to adjust time';
      const status = message.includes('Cannot remove') ? 400 : 500;
      if (status === 500) console.error(err);
      res.status(status).json({ error: message });
    }
  }
);

transactionsRouter.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(5, parseInt(String(req.query.pageSize ?? '25'), 10) || 25)
    );

    const total = await Transaction.countDocuments();
    const items = await Transaction.find()
      .populate('userId', 'username')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    res.json({ items, total, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list transactions' });
  }
});
