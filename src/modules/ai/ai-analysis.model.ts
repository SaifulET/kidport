import { Schema, model, type InferSchemaType } from 'mongoose';

const aiAnalysisSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    reportId: { type: Schema.Types.ObjectId, ref: 'Report' },
    kind: { type: String, enum: ['report', 'guidance', 'observation'], required: true, index: true },
    sourceHash: { type: String, required: true, index: true },
    model: String,
    promptVersion: String,
    output: Schema.Types.Mixed,
    generatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

aiAnalysisSchema.index({ childId: 1, kind: 1, sourceHash: 1 });
export type AIAnalysisAttrs = InferSchemaType<typeof aiAnalysisSchema>;
export const AIAnalysis = model('AIAnalysis', aiAnalysisSchema);
