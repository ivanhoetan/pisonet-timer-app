import { Router } from 'express';
import { User } from '../models/User';
import { authMiddleware, userMiddleware, AuthRequest } from '../middleware/auth';

export const usersRouter = Router();

usersRouter.get('/me', authMiddleware, userMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.auth!.sub).select('-passwordHash -pinHash');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user._id,
      username: user.username,
      balanceSeconds: user.balanceSeconds,
      mobileNumber: user.mobileNumber,
      status: user.status,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});
