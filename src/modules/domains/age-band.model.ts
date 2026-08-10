import { Schema, model, type InferSchemaType } from 'mongoose';

const ageBandSchema = new Schema(
  {
    label: { type: String, required: true },
    minMonths: { type: Number, required: true },
    maxMonths: { type: Number, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

export type AgeBandAttrs = InferSchemaType<typeof ageBandSchema>;
export const AgeBand = model('AgeBand', ageBandSchema);
