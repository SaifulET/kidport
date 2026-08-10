import { Schema, model, type InferSchemaType } from 'mongoose';
import { CAREGIVER_ROLES, DAYCARE_ROLES } from '../../constants/roles';

const careCircleMembershipSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: [...CAREGIVER_ROLES, ...DAYCARE_ROLES, 'daycare'], required: true },
    relationship: { type: String, required: true },
    permissions: {
      canView: { type: Boolean, default: true },
      canComment: { type: Boolean, default: true },
      canObserve: { type: Boolean, default: true },
      canInvite: { type: Boolean, default: false },
      canManage: { type: Boolean, default: false }
    },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'removed'], default: 'active', index: true }
  },
  { timestamps: true }
);

careCircleMembershipSchema.index({ childId: 1, userId: 1 }, { unique: true });
export type CareCircleMembershipAttrs = InferSchemaType<typeof careCircleMembershipSchema>;
export const CareCircleMembership = model('CareCircleMembership', careCircleMembershipSchema);
