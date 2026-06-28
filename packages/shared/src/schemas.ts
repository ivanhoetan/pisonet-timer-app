import { z } from 'zod';

export const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(128),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  mobileNumber: z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const pinLoginSchema = z.object({
  username: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/),
  computerId: z.string().min(1),
});

export const passwordLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  computerId: z.string().min(1),
});

export const pinLogoutSchema = z.object({
  username: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/),
  computerId: z.string().min(1),
});

export const endComputerSessionSchema = z.object({
  computerId: z.string().min(1),
  authSecret: z.string().min(1),
  sessionId: z.string().min(1),
});

export const registerComputerSchema = z.object({
  computerCode: z.string().min(2).max(16).regex(/^[A-Z0-9_-]+$/),
  name: z.string().min(1).max(64),
});

export const heartbeatSchema = z.object({
  computerId: z.string().min(1),
});

export const startSessionSchema = z.object({
  computerId: z.string().min(1),
});

export const endSessionSchema = z.object({
  sessionId: z.string().min(1),
});

export const createTransactionSchema = z
  .object({
    userId: z.string().min(1),
    // Either charge in pesos (minutes are derived) or grant free minutes directly.
    pesos: z.number().positive().optional(),
    minutesAdded: z.number().int().positive().optional(),
    paymentMethod: z.string().default('manual'),
    paymentReference: z.string().optional(),
  })
  .refine((data) => data.pesos !== undefined || data.minutesAdded !== undefined, {
    message: 'Provide pesos or minutesAdded',
  });

export const adjustTimeSchema = z.object({
  userId: z.string().min(1),
  minutesRemoved: z.number().int().positive(),
  reason: z.string().max(200).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const adminCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
  role: z.enum(['owner', 'staff']).optional(),
});

export const redeemLoyaltySchema = z.object({
  userId: z.string().min(1),
  rewards: z.number().int().positive().optional(),
});

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
});

export const adminCreateUserSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(128),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  mobileNumber: z.string().max(20).optional(),
  initialMinutes: z.number().int().min(0).optional(),
});

export const adminUpdateUserSchema = z
  .object({
    username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(),
    password: z.string().min(6).max(128).optional(),
    pin: z.string().regex(/^\d{4,6}$/).optional(),
    mobileNumber: z.string().max(20).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'No fields to update',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PinLoginInput = z.infer<typeof pinLoginSchema>;
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;
