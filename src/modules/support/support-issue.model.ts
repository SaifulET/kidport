import { Schema, model, type InferSchemaType } from 'mongoose';

const attachmentSchema = new Schema(
  { key: String, url: String, mimeType: String, size: Number, originalName: String },
  { _id: false }
);

const supportIssueSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    urgency: { type: String, enum: ['low', 'medium', 'high'], required: true },
    attachments: [attachmentSchema],
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' }
  },
  { timestamps: true }
);

export type SupportIssueAttrs = InferSchemaType<typeof supportIssueSchema>;
export const SupportIssue = model('SupportIssue', supportIssueSchema);
