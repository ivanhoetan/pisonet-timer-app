import { Router } from 'express';
import { createTransactionSchema } from '@pisonet/shared';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import { validateBody } from '../middleware/validate';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';

export const transactionsRouter = Router();

transactionsRouter.post(
  '/',
  authMiddleware,
  adminMiddleware,
  validateBody(createTransactionSchema),
  async (req: AuthRequest, res) => {
    try {
      const { userId, minutesAdded, paymentMethod, paymentReference } = req.body;
      const secondsAdded = minutesAdded * 60;

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      user.balanceSeconds += secondsAdded;
      await user.save();

      const transaction = await Transaction.create({
        userId,
        minutesAdded,
        paymentMethod,
        paymentReference,
        createdBy: req.auth!.sub,
      });

      const activeSession = sessionEngine.getByUserId(userId);
      if (activeSession) {
        await sessionEngine.addTime(activeSession.sessionId, secondsAdded);
      }

      res.status(201).json({
        transaction,
        newBalanceSeconds: user.balanceSeconds,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  }
);

transactionsRouter.get('/', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate('userId', 'username')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list transactions' });
  }
});
