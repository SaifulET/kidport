import { Schema, model, type InferSchemaType } from 'mongoose';

const reportSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    type: { type: String, enum: ['development'], default: 'development' },
    startDate: Date,
    endDate: Date,
    sourceObservationIds: [{ type: Schema.Types.ObjectId, ref: 'Observation' }],
    sourceHash: { type: String, required: true, index: true },
    model: String,
    payload: Schema.Types.Mixed,
    pdf: { key: String, mimeType: String, size: Number },
    disclaimerVersion: String,
    generatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

reportSchema.index({ childId: 1, type: 1, sourceHash: 1 });
export type ReportAttrs = InferSchemaType<typeof reportSchema>;
export const Report = model('Report', reportSchema);
