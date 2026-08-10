import { Schema, model, type InferSchemaType } from 'mongoose';

const invitationSchema = new Schema(
  {
    type: { type: String, enum: ['care_circle', 'daycare_child_assignment', 'daycare_member'], required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    childId: { type: Schema.Types.ObjectId, ref: 'Child', index: true },
    daycareId: { type: Schema.Types.ObjectId, ref: 'Daycare', index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: String,
    relationship: String,
    message: String,
    status: { type: String, enum: ['pending', 'accepted', 'revoked', 'expired'], default: 'pending', index: true },
    expiresAt: { type: Date, required: true, index: true },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: Date
  },
  { timestamps: true }
);

export type InvitationAttrs = InferSchemaType<typeof invitationSchema>;
export const Invitation = model('Invitation', invitationSchema);
