import { Schema, model, type InferSchemaType } from 'mongoose';

const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planName: { type: String, required: true, trim: true },
    planInterval: { type: String, enum: ['monthly', 'yearly'], required: true, index: true },
    amountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD', uppercase: true },
    paymentMethodLabel: String,
    status: { type: String, enum: ['active', 'expiring', 'cancelled', 'past_due'], default: 'active', index: true },
    startedAt: { type: Date, default: Date.now },
    renewsAt: Date,
    cancelledAt: Date
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });

export type SubscriptionAttrs = InferSchemaType<typeof subscriptionSchema>;
export const Subscription = model('Subscription', subscriptionSchema);
