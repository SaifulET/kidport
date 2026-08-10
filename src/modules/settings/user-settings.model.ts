import { Schema, model, type InferSchemaType } from 'mongoose';

const userSettingsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    language: { type: String, default: 'en' },
    notifications: {
      milestoneAchievements: { type: Boolean, default: true },
      careCircleUpdates: { type: Boolean, default: true },
      aiInsights: { type: Boolean, default: true },
      weeklyReports: { type: Boolean, default: true }
    },
    security: Schema.Types.Mixed
  },
  { timestamps: true }
);

export type UserSettingsAttrs = InferSchemaType<typeof userSettingsSchema>;
export const UserSettings = model('UserSettings', userSettingsSchema);
