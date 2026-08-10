import { Schema, model, type InferSchemaType } from 'mongoose';

const commentSchema = new Schema(
  {
    observationId: { type: Schema.Types.ObjectId, ref: 'Observation', required: true, index: true },
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['active', 'deleted'], default: 'active', index: true }
  },
  { timestamps: true }
);

export type CommentAttrs = InferSchemaType<typeof commentSchema>;
export const Comment = model('Comment', commentSchema);
