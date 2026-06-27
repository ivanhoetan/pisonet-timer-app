import { z } from 'zod';

export const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(128),
  pin: z.string().regex(/^\d{4,6}$/),
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

export const createTransactionSchema = z.object({
  userId: z.string().min(1),
  minutesAdded: z.number().int().positive(),
  paymentMethod: z.string().default('manual'),
  paymentReference: z.string().optional(),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PinLoginInput = z.infer<typeof pinLoginSchema>;
