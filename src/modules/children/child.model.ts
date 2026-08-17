import { Schema, model, type InferSchemaType } from 'mongoose';

const mediaSchema = new Schema(
  { key: String, url: String, mimeType: String, size: Number },
  { _id: false }
);

const measurementSchema = new Schema(
  { value: Number, unit: String, measuredAt: Date },
  { _id: false }
);

const domainProgressSchema = new Schema(
  {
    domainId: { type: Schema.Types.ObjectId, ref: 'DevelopmentDomain' },
    name: String,
    percentage: Number,
    stage: { type: String, enum: ['emerging', 'building', 'steady', 'confident', 'not_enough_data'] },
    observationCount: { type: Number, default: 0 },
    keyword: { type: String, enum: ['improving', 'stable', 'needs-support', 'not-enough-data'] }
  },
  { _id: false }
);

const developmentalAgeDomainMatchSchema = new Schema(
  {
    domainId: String,
    name: String,
    estimatedMonths: Number,
    note: String
  },
  { _id: false }
);

const developmentalAgeSchema = new Schema(
  {
    months: Number,
    years: Number,
    remainingMonths: Number,
    days: Number,
    label: String,
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    basis: String,
    domainMatches: [developmentalAgeDomainMatchSchema],
    calculatedAt: Date,
    model: String
  },
  { _id: false }
);

const childSchema = new Schema(
  {
    profilePhoto: mediaSchema,
    fullName: { type: String, required: true, trim: true, index: true },
    nickname: String,
    dateOfBirth: { type: Date, required: true, index: true },
    gender: { type: String, enum: ['female', 'male', 'non_binary', 'prefer_not_to_say', 'other'] },
    bloodType: String,
    height: measurementSchema,
    weight: measurementSchema,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    caregivers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    daycare: { type: Schema.Types.ObjectId, ref: 'Daycare' },
    classroom: { type: Schema.Types.ObjectId, ref: 'Classroom' },
    developmentProgress: [domainProgressSchema],
    developmentOverallScore: Number,
    developmentalAge: developmentalAgeSchema,
    developmentLastCalculatedAt: Date,
    status: { type: String, enum: ['active', 'archived', 'deleted'], default: 'active', index: true },
    deletedAt: Date
  },
  { timestamps: true }
);

childSchema.index({ createdBy: 1, status: 1 });

const transformProfilePhoto = (_doc: unknown, ret: Record<string, unknown>) => {
  const profilePhoto = ret.profilePhoto as { url?: string } | string | undefined;
  ret.profilePhoto = typeof profilePhoto === 'string' ? profilePhoto : profilePhoto?.url ?? null;
  return ret;
};

childSchema.set('toJSON', { transform: transformProfilePhoto });
childSchema.set('toObject', { transform: transformProfilePhoto });

export type ChildAttrs = InferSchemaType<typeof childSchema>;
export const Child = model('Child', childSchema);
