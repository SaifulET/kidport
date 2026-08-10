import { Schema, model, type InferSchemaType } from 'mongoose';

const daycareSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    address: String,
    phoneNumber: String,
    email: { type: String, lowercase: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['active', 'disabled', 'deleted'], default: 'active', index: true }
  },
  { timestamps: true }
);

export type DaycareAttrs = InferSchemaType<typeof daycareSchema>;
export const Daycare = model('Daycare', daycareSchema);
