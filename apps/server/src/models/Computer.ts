import mongoose, { Schema, Document } from 'mongoose';
import { ComputerStatus } from '@pisonet/shared';

export interface IComputer extends Document {
  computerCode: string;
  name: string;
  status: ComputerStatus;
  authSecret: string;
  lastOnline?: Date;
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
  },
  { timestamps: true }
);

export const Computer = mongoose.model<IComputer>('Computer', computerSchema);
