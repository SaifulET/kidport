import { Schema, model, type InferSchemaType } from 'mongoose';

const classroomSchema = new Schema(
  {
    daycareId: { type: Schema.Types.ObjectId, ref: 'Daycare', required: true, index: true },
    name: { type: String, required: true, trim: true },
    icon: String,
    theme: String,
    ageBand: String,
    leadTeacher: { type: Schema.Types.ObjectId, ref: 'User' },
    description: String,
    capacity: Number,
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true }
  },
  { timestamps: true }
);

classroomSchema.index({ daycareId: 1, name: 1 });
export type ClassroomAttrs = InferSchemaType<typeof classroomSchema>;
export const Classroom = model('Classroom', classroomSchema);
