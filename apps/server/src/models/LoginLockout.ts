import mongoose, { Schema, Document } from 'mongoose';

export interface ILoginLockout extends Document {
  accountKey: string;
  failedAttempts: number;
  lockedUntil?: Date;
}

const loginLockoutSchema = new Schema<ILoginLockout>(
  {
    accountKey: { type: String, required: true, unique: true, index: true },
    failedAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const LoginLockout = mongoose.model<ILoginLockout>('LoginLockout', loginLockoutSchema);
