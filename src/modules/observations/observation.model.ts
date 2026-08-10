import { Schema, model, type InferSchemaType } from 'mongoose';
import { STAGE_VALUES } from '../../constants/stages';

const observationMediaSchema = new Schema(
  {
    key: { type: String, required: true },
    url: String,
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    originalName: String,
    metadata: Schema.Types.Mixed
  },
  { _id: true }
);

const observationSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorRelationship: String,
    daycareId: { type: Schema.Types.ObjectId, ref: 'Daycare', index: true },
    classroomId: { type: Schema.Types.ObjectId, ref: 'Classroom', index: true },
    type: { type: String, enum: ['text', 'voice', 'photo', 'video'], required: true, index: true },
    text: String,
    media: [observationMediaSchema],
    domainId: { type: Schema.Types.ObjectId, ref: 'DevelopmentDomain', index: true },
    indicatorId: { type: Schema.Types.ObjectId, ref: 'DevelopmentIndicator', index: true },
    stage: { type: String, enum: STAGE_VALUES },
    stageScore: Number,
    mood: String,
    occurredAt: { type: Date, default: Date.now, index: true },
    aiMetadata: Schema.Types.Mixed,
    isMilestone: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ['active', 'hidden', 'deleted'], default: 'active', index: true }
  },
  { timestamps: true }
);

observationSchema.index({ childId: 1, createdAt: -1 });
observationSchema.index({ childId: 1, domainId: 1, createdAt: -1 });
observationSchema.index({ authorId: 1, createdAt: -1 });
observationSchema.index({ isMilestone: 1, childId: 1 });
observationSchema.index({ classroomId: 1, createdAt: -1 });

export type ObservationAttrs = InferSchemaType<typeof observationSchema>;
export const Observation = model('Observation', observationSchema);
