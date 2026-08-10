import { Schema, model, type InferSchemaType } from 'mongoose';

const developmentIndicatorSchema = new Schema(
  {
    domainId: { type: Schema.Types.ObjectId, ref: 'DevelopmentDomain', required: true, index: true },
    ageBandId: { type: Schema.Types.ObjectId, ref: 'AgeBand', required: true, index: true },
    title: { type: String, required: true },
    description: String,
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true }
  },
  { timestamps: true }
);

developmentIndicatorSchema.index({ domainId: 1, ageBandId: 1 });
export type DevelopmentIndicatorAttrs = InferSchemaType<typeof developmentIndicatorSchema>;
export const DevelopmentIndicator = model('DevelopmentIndicator', developmentIndicatorSchema);
