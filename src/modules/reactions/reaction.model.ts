import { Schema, model, type InferSchemaType } from 'mongoose';

const reactionSchema = new Schema(
  {
    observationId: { type: Schema.Types.ObjectId, ref: 'Observation', required: true, index: true },
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['love'], default: 'love' }
  },
  { timestamps: true }
);

reactionSchema.index({ observationId: 1, userId: 1, type: 1 }, { unique: true });
export type ReactionAttrs = InferSchemaType<typeof reactionSchema>;
export const Reaction = model('Reaction', reactionSchema);
