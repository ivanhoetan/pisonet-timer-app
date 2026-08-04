import { z } from 'zod';

const usernameField = z
  .string({ required_error: 'Username is required' })
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username cannot exceed 32 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores');

const passwordField = z
  .string({ required_error: 'Password is required' })
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password cannot exceed 128 characters');

const pinField = z
  .string()
  .regex(/^\d{4,6}$/, 'PIN must be 4–6 digits')
  .optional();

const requiredPinField = z
  .string({ required_error: 'PIN is required' })
  .regex(/^\d{4,6}$/, 'PIN must be 4–6 digits');

export const registerSchema = z.object({
  username: usernameField,
  nickname: z.string().max(40, 'Nickname cannot exceed 40 characters').optional(),
  password: passwordField,
  pin: pinField,
  mobileNumber: z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string({ required_error: 'Username is required' }).min(1, 'Username is required'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export const pinLoginSchema = z.object({
  username: z.string({ required_error: 'Username is required' }).min(1, 'Username is required'),
  pin: requiredPinField,
  computerId: z.string({ required_error: 'Computer is required' }).min(1, 'Computer is required'),
});

export const passwordLoginSchema = z.object({
  username: z.string({ required_error: 'Username is required' }).min(1, 'Username is required'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
  computerId: z.string({ required_error: 'Computer is required' }).min(1, 'Computer is required'),
});

export const pinLogoutSchema = z.object({
  username: z.string({ required_error: 'Username is required' }).min(1, 'Username is required'),
  pin: requiredPinField,
  computerId: z.string({ required_error: 'Computer is required' }).min(1, 'Computer is required'),
});

export const endComputerSessionSchema = z.object({
  computerId: z.string({ required_error: 'Computer is required' }).min(1, 'Computer is required'),
  authSecret: z.string({ required_error: 'Auth secret is required' }).min(1, 'Auth secret is required'),
  sessionId: z.string({ required_error: 'Session is required' }).min(1, 'Session is required'),
});

export const registerComputerSchema = z.object({
  computerCode: z
    .string({ required_error: 'Computer code is required' })
    .min(2, 'Computer code must be at least 2 characters')
    .max(16, 'Computer code cannot exceed 16 characters')
    .regex(/^[A-Z0-9_-]+$/, 'Computer code may only contain letters, numbers, - and _'),
  name: z
    .string({ required_error: 'Name is required' })
    .min(1, 'Name is required')
    .max(64, 'Name cannot exceed 64 characters'),
});

// Quick-pair: the client redeems a short, single-use code for its credentials.
export const claimComputerSchema = z.object({
  code: z
    .string({ required_error: 'Pairing code is required' })
    .min(4, 'Pairing code is too short')
    .max(16, 'Pairing code is too long'),
});

export const heartbeatSchema = z.object({
  computerId: z.string({ required_error: 'Computer is required' }).min(1, 'Computer is required'),
});

export const startSessionSchema = z.object({
  computerId: z.string({ required_error: 'Computer is required' }).min(1, 'Computer is required'),
});

export const endSessionSchema = z.object({
  sessionId: z.string({ required_error: 'Session is required' }).min(1, 'Session is required'),
});

export const createTransactionSchema = z
  .object({
    userId: z.string({ required_error: 'User is required' }).min(1, 'User is required'),
    // Either charge in pesos (minutes are derived) or grant free minutes directly.
    pesos: z.number({ invalid_type_error: 'Amount must be a number' }).positive('Amount must be greater than zero').optional(),
    minutesAdded: z
      .number({ invalid_type_error: 'Minutes must be a number' })
      .int('Minutes must be a whole number')
      .positive('Minutes must be greater than zero')
      .optional(),
    paymentMethod: z.string().default('manual'),
    paymentReference: z.string().optional(),
  })
  .refine((data) => data.pesos !== undefined || data.minutesAdded !== undefined, {
    message: 'Enter an amount in pesos or minutes to add',
  });

export const adjustTimeSchema = z.object({
  userId: z.string({ required_error: 'User is required' }).min(1, 'User is required'),
  minutesRemoved: z
    .number({ required_error: 'Minutes to remove is required', invalid_type_error: 'Minutes must be a number' })
    .int('Minutes must be a whole number')
    .positive('Enter at least 1 minute to remove'),
  reason: z.string().max(200, 'Reason cannot exceed 200 characters').optional(),
});

export const transferTimeSchema = z.object({
  fromUserId: z.string({ required_error: 'Source user is required' }).min(1, 'Source user is required'),
  toUserId: z.string({ required_error: 'Destination user is required' }).min(1, 'Destination user is required'),
  minutes: z
    .number({ required_error: 'Minutes to transfer is required', invalid_type_error: 'Minutes must be a number' })
    .int('Minutes must be a whole number')
    .positive('Enter at least 1 minute to transfer'),
  reason: z.string().max(200, 'Reason cannot exceed 200 characters').optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, 'Current password is required'),
  newPassword: passwordField,
});

export const adminLoginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .min(1, 'Email is required')
    .email('Enter a valid email address'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export const adminCreateSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .min(1, 'Email is required')
    .email('Enter a valid email address'),
  password: passwordField,
  role: z.enum(['owner', 'staff']).optional(),
});

export const redeemLoyaltySchema = z.object({
  userId: z.string({ required_error: 'User is required' }).min(1, 'User is required'),
  rewards: z
    .number({ invalid_type_error: 'Rewards must be a number' })
    .int('Rewards must be a whole number')
    .positive('Rewards must be at least 1')
    .optional(),
});

export const adjustStampsSchema = z.object({
  userId: z.string({ required_error: 'User is required' }).min(1, 'User is required'),
  stampsRemoved: z
    .number({ required_error: 'Stamps to remove is required', invalid_type_error: 'Stamps must be a number' })
    .int('Stamps must be a whole number')
    .positive('Enter at least 1 stamp to remove'),
  reason: z.string().max(200, 'Reason cannot exceed 200 characters').optional(),
});

export const maintenanceSchema = z.object({
  enabled: z.boolean({ required_error: 'Enabled flag is required' }),
});

export const adminCreateUserSchema = z.object({
  username: usernameField,
  nickname: z.string().max(40, 'Nickname cannot exceed 40 characters').optional(),
  password: passwordField,
  pin: pinField,
  mobileNumber: z.string().max(20, 'Mobile number cannot exceed 20 characters').optional(),
  initialMinutes: z
    .number({ invalid_type_error: 'Starting time must be a number' })
    .int('Starting time must be a whole number')
    .min(0, 'Starting time cannot be negative')
    .optional(),
});

export const adminUpdateUserSchema = z
  .object({
    username: usernameField.optional(),
    nickname: z.string().max(40, 'Nickname cannot exceed 40 characters').optional(),
    password: passwordField.optional(),
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits').optional(),
    mobileNumber: z.string().max(20, 'Mobile number cannot exceed 20 characters').optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Change at least one field before saving',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PinLoginInput = z.infer<typeof pinLoginSchema>;
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;
export type ClaimComputerInput = z.infer<typeof claimComputerSchema>;
