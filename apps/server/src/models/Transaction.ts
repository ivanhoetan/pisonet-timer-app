import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  userId: Types.ObjectId;
  minutesAdded: number;
  amountPaid?: number;
  paymentMethod: string;
  paymentReference?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    minutesAdded: { type: Number, required: true },
    amountPaid: { type: Number },
    paymentMethod: { type: String, required: true, default: 'manual' },
    paymentReference: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
