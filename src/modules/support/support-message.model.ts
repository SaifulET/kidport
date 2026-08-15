import { Schema, model, type InferSchemaType } from 'mongoose';

const supportMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sender: { type: String, enum: ['user', 'support'], required: true },
    text: { type: String, required: true, trim: true },
    status: { type: String, enum: ['sent', 'read'], default: 'sent' },
    readAt: Date
  },
  { timestamps: true }
);

supportMessageSchema.index({ userId: 1, createdAt: 1 });

export type SupportMessageAttrs = InferSchemaType<typeof supportMessageSchema>;
export const SupportMessage = model('SupportMessage', supportMessageSchema);
