import mongoose, { Schema, Document } from 'mongoose';
import { ComputerStatus } from '@pisonet/shared';

export interface IComputer extends Document {
  computerCode: string;
  name: string;
  status: ComputerStatus;
  authSecret: string;
  lastOnline?: Date;
  // Short, single-use quick-pair code (cleared once redeemed or expired).
  pairingCode?: string;
  pairingCodeExpires?: Date;
}

const computerSchema = new Schema<IComputer>(
  {
    computerCode: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(ComputerStatus),
      default: ComputerStatus.OFFLINE,
    },
    authSecret: { type: String, required: true },
    lastOnline: { type: Date },
    pairingCode: { type: String, index: true, sparse: true },
    pairingCodeExpires: { type: Date },
  },
  { timestamps: true }
);

export const Computer = mongoose.model<IComputer>('Computer', computerSchema);
