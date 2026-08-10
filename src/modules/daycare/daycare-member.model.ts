import { Schema, model, type InferSchemaType } from 'mongoose';
import { DAYCARE_ROLES } from '../../constants/roles';

const daycareMemberSchema = new Schema(
  {
    daycareId: { type: Schema.Types.ObjectId, ref: 'Daycare', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: DAYCARE_ROLES, required: true },
    classroomIds: [{ type: Schema.Types.ObjectId, ref: 'Classroom' }],
    status: { type: String, enum: ['active', 'removed'], default: 'active', index: true }
  },
  { timestamps: true }
);

daycareMemberSchema.index({ daycareId: 1, userId: 1 }, { unique: true });
export type DaycareMemberAttrs = InferSchemaType<typeof daycareMemberSchema>;
export const DaycareMember = model('DaycareMember', daycareMemberSchema);
