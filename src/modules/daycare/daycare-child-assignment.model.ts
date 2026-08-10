import { Schema, model, type InferSchemaType } from 'mongoose';

const daycareChildAssignmentSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    daycareId: { type: Schema.Types.ObjectId, ref: 'Daycare', required: true, index: true },
    classroomId: { type: Schema.Types.ObjectId, ref: 'Classroom', index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: Date,
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: Date,
    status: { type: String, enum: ['pending', 'active', 'revoked'], default: 'pending', index: true }
  },
  { timestamps: true }
);

daycareChildAssignmentSchema.index({ childId: 1, daycareId: 1 }, { unique: true });
export type DaycareChildAssignmentAttrs = InferSchemaType<typeof daycareChildAssignmentSchema>;
export const DaycareChildAssignment = model('DaycareChildAssignment', daycareChildAssignmentSchema);
