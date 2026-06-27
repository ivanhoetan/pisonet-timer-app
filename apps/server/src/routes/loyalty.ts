import { Router } from 'express';
import {
  redeemLoyaltySchema,
  STAMPS_PER_REWARD,
  REWARD_MINUTES,
  rewardsAvailable,
} from '@pisonet/shared';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';
import { validateBody } from '../middleware/validate';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';
import { sessionEngine } from '../services/sessionEngine';
import { recordAudit } from '../services/audit';

export const loyaltyRouter = Router();

// Redeem loyalty stamps for free time. Each reward = STAMPS_PER_REWARD stamps
// converted to REWARD_MINUTES of free play. Rewards stack, so the admin can
// redeem several at once.
loyaltyRouter.post(
  '/redeem',
  authMiddleware,
  adminMiddleware,
  validateBody(redeemLoyaltySchema),
  async (req: AuthRequest, res) => {
    try {
      const { userId, rewards } = req.body as { userId: string; rewards?: number };

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const available = rewardsAvailable(user.loyaltyStamps);
      if (available <= 0) {
        res.status(400).json({
          error: `Not enough stamps. Need ${STAMPS_PER_REWARD} for one free hour.`,
        });
        return;
      }

      const toRedeem = rewards ? Math.min(rewards, available) : available;
      const stampsSpent = toRedeem * STAMPS_PER_REWARD;
      const minutesAdded = toRedeem * REWARD_MINUTES;
      const secondsAdded = minutesAdded * 60;

      user.loyaltyStamps -= stampsSpent;
      user.balanceSeconds += secondsAdded;
      // +1 point per free hour redeemed (not per stamp).
      user.points += toRedeem;
      await user.save();

      const transaction = await Transaction.create({
        userId,
        minutesAdded,
        amountPaid: 0,
        paymentMethod: 'loyalty',
        paymentReference: `Redeemed ${stampsSpent} stamps`,
        createdBy: req.auth!.sub,
      });

      const activeSession = sessionEngine.getByUserId(userId);
      if (activeSession) {
        await sessionEngine.addTime(activeSession.sessionId, secondsAdded);
      }

      recordAudit(req, {
        action: 'loyalty_redeem',
        targetType: 'user',
        targetId: userId,
        targetLabel: user.username,
        details: `-${stampsSpent} stamps for ${minutesAdded} free min · +${toRedeem} point(s)`,
      });

      res.status(201).json({
        transaction,
        newBalanceSeconds: user.balanceSeconds,
        loyaltyStamps: user.loyaltyStamps,
        points: user.points,
        rewardsRedeemed: toRedeem,
        minutesAdded,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to redeem loyalty reward' });
    }
  }
);
