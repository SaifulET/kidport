import { Schema, model, type InferSchemaType } from 'mongoose';

const legalAcceptanceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    termsVersion: { type: String, required: true },
    privacyVersion: String,
    aiDisclaimerVersion: String,
    acceptedAt: { type: Date, default: Date.now },
    ip: String,
    userAgent: String
  },
  { timestamps: true }
);

export type LegalAcceptanceAttrs = InferSchemaType<typeof legalAcceptanceSchema>;
export const LegalAcceptance = model('LegalAcceptance', legalAcceptanceSchema);
