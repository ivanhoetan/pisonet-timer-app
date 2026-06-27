import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  pinHash: string;
  balanceSeconds: number;
  mobileNumber?: string;
  status: 'active' | 'disabled';
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
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const User = mongoose.model<IUser>('User', userSchema);
