import mongoose, { Schema, Document, Types } from 'mongoose';
import { SessionStatus } from '@pisonet/shared';

export interface ISession extends Document {
  userId: Types.ObjectId;
  computerId: Types.ObjectId;
  status: SessionStatus;
  startedAt: Date;
  pausedAt?: Date;
  endedAt?: Date;
  secondsUsed: number;
  secondsAllocated: number;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    computerId: { type: Schema.Types.ObjectId, ref: 'Computer', required: true, index: true },
    status: {
      type: String,
      enum: Object.values(SessionStatus),
      required: true,
    },
    startedAt: { type: Date, required: true },
    pausedAt: { type: Date },
    endedAt: { type: Date },
    secondsUsed: { type: Number, default: 0 },
    secondsAllocated: { type: Number, required: true },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, status: 1 });

sessionSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: SessionStatus.ACTIVE },
    name: 'uniq_active_session_per_user',
  }
);

sessionSchema.index(
  { computerId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: SessionStatus.ACTIVE },
    name: 'uniq_active_session_per_computer',
  }
);

export const Session = mongoose.model<ISession>('Session', sessionSchema);
