import { Schema, model, type InferSchemaType } from 'mongoose';

const legalDocumentSchema = new Schema(
  {
    key: { type: String, enum: ['terms', 'privacy-policy', 'ai-disclaimer'], required: true, index: true },
    version: { type: String, required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    effectiveAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true }
  },
  { timestamps: true }
);

legalDocumentSchema.index({ key: 1, status: 1, effectiveAt: -1 });
export type LegalDocumentAttrs = InferSchemaType<typeof legalDocumentSchema>;
export const LegalDocument = model('LegalDocument', legalDocumentSchema);
