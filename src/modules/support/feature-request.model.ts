import { Schema, model, type InferSchemaType } from 'mongoose';

const imageSchema = new Schema(
  { key: String, url: String, mimeType: String, size: Number, originalName: String },
  { _id: false }
);

const featureRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['new_feature', 'improvement', 'design_ui', 'integration'], required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    impact: { type: String, enum: ['nice_to_have', 'important', 'game_changer'], required: true },
    images: [imageSchema],
    status: { type: String, enum: ['submitted', 'reviewing', 'planned', 'closed'], default: 'submitted' }
  },
  { timestamps: true }
);

export type FeatureRequestAttrs = InferSchemaType<typeof featureRequestSchema>;
export const FeatureRequest = model('FeatureRequest', featureRequestSchema);
