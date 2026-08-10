import { Schema, model, type InferSchemaType } from 'mongoose';

const developmentDomainSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, trim: true, unique: true, index: true },
    description: String,
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true }
  },
  { timestamps: true }
);

export type DevelopmentDomainAttrs = InferSchemaType<typeof developmentDomainSchema>;
export const DevelopmentDomain = model('DevelopmentDomain', developmentDomainSchema);
