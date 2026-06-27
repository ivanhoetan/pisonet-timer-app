import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  pinHash: string;
  balanceSeconds: number;
  mobileNumber?: string;
  status: 'active' | 'disabled';
  loyaltyStamps: number;
  points: number;
  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    pinHash: { type: String, required: true },
    balanceSeconds: { type: Number, required: true, default: 0 },
    mobileNumber: { type: String },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    // Loyalty: unredeemed stamps (1 per ₱12 within a single payment).
    loyaltyStamps: { type: Number, required: true, default: 0 },
    // Lifetime reward points: +1 per free hour redeemed. Used for monthly bonuses.
    points: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const User = mongoose.model<IUser>('User', userSchema);
