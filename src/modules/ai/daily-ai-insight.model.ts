import { Schema, model, type InferSchemaType } from 'mongoose';

const domainHighlightSchema = new Schema(
  {
    domain: { type: String, required: true },
    status: { type: String, required: true },
    keyword: { type: String, required: true }
  },
  { _id: false }
);

const dailyAiInsightSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    localDate: { type: String, required: true, index: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    suggestion: { type: String, required: true },
    parentTips: { type: [String], default: [] },
    domainHighlights: [domainHighlightSchema],
    disclaimer: { type: String, required: true },
    generatedAt: { type: Date, required: true, default: Date.now },
    model: String,
    status: { type: String, enum: ['generated', 'fallback'], default: 'generated', index: true }
  },
  { timestamps: true }
);

dailyAiInsightSchema.index({ childId: 1, localDate: 1 }, { unique: true });

export type DailyAiInsightAttrs = InferSchemaType<typeof dailyAiInsightSchema>;
export const DailyAiInsight = model('DailyAiInsight', dailyAiInsightSchema);
