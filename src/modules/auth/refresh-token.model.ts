import { Schema, model, type InferSchemaType } from 'mongoose';

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: Date,
    replacedByTokenHash: String,
    userAgent: String,
    ip: String
  },
  { timestamps: true }
);

export type RefreshTokenAttrs = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshToken = model('RefreshToken', refreshTokenSchema);
