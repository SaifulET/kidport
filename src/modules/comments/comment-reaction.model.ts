import { Schema, model, type InferSchemaType } from 'mongoose';

const commentReactionSchema = new Schema(
  {
    commentId: { type: Schema.Types.ObjectId, ref: 'Comment', required: true, index: true },
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['love'], default: 'love' }
  },
  { timestamps: true }
);

commentReactionSchema.index({ commentId: 1, userId: 1, type: 1 }, { unique: true });

export type CommentReactionAttrs = InferSchemaType<typeof commentReactionSchema>;
export const CommentReaction = model('CommentReaction', commentReactionSchema);
