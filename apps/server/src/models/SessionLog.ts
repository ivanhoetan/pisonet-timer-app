import mongoose, { Schema, Document, Types } from 'mongoose';

export const SessionLogAction = {
  LOGIN: 'login',
  LOGOUT: 'logout',
} as const;

export type SessionLogAction = (typeof SessionLogAction)[keyof typeof SessionLogAction];

export const SessionLogReason = {
  CUSTOMER: 'customer',
  EXPIRED: 'expired',
  STAFF: 'staff',
} as const;

export type SessionLogReason = (typeof SessionLogReason)[keyof typeof SessionLogReason];

export interface ISessionLog extends Document {
  userId: Types.ObjectId;
  username: string;
  computerId: Types.ObjectId;
  action: SessionLogAction;
  reason: SessionLogReason;
  remainingSeconds: number;
  createdAt: Date;
}

const sessionLogSchema = new Schema<ISessionLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    username: { type: String, required: true },
    computerId: { type: Schema.Types.ObjectId, ref: 'Computer', required: true },
    action: {
      type: String,
      enum: Object.values(SessionLogAction),
      required: true,
    },
    reason: {
      type: String,
      enum: Object.values(SessionLogReason),
      required: true,
    },
    remainingSeconds: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

sessionLogSchema.index({ createdAt: -1 });
sessionLogSchema.index({ action: 1, createdAt: -1 });

export const SessionLog = mongoose.model<ISessionLog>('SessionLog', sessionLogSchema);
