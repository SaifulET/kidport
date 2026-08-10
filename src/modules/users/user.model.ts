import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { CAREGIVER_ROLES, DAYCARE_ROLES, USER_TYPES } from '../../constants/roles';

const mediaSchema = new Schema(
  {
    key: String,
    url: String,
    mimeType: String,
    size: Number
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    userType: { type: String, enum: USER_TYPES, required: true, index: true },
    caregiverRole: { type: String, enum: CAREGIVER_ROLES },
    daycareRole: { type: String, enum: DAYCARE_ROLES },
    phoneNumber: String,
    bio: String,
    profilePhoto: mediaSchema,
    status: { type: String, enum: ['active', 'disabled', 'deleted'], default: 'active', index: true },
    passwordResetTokenHash: String,
    passwordResetExpiresAt: Date,
    emailVerifiedAt: Date,
    activeChildId: { type: Schema.Types.ObjectId, ref: 'Child' },
    deletedAt: Date
  },
  { timestamps: true }
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type IUser = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);
