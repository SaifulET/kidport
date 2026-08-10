import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { RefreshToken } from '../modules/auth/refresh-token.model';
import { hashToken, randomToken } from '../utils/crypto';

const durationToMs = (duration: string) => {
  const match = /^(\d+)([mhd])$/.exec(duration);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
};

export class TokenService {
  static signAccessToken(userId: Types.ObjectId | string) {
    return jwt.sign({ sub: userId.toString(), type: 'access' }, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn']
    });
  }

  static async issueRefreshToken(userId: Types.ObjectId | string, meta: { ip?: string; userAgent?: string }) {
    const token = randomToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + durationToMs(env.JWT_REFRESH_EXPIRES_IN));
    await RefreshToken.create({ userId, tokenHash, expiresAt, ip: meta.ip, userAgent: meta.userAgent });
    return token;
  }

  static async rotateRefreshToken(token: string, meta: { ip?: string; userAgent?: string }) {
    const existing = await RefreshToken.findOne({ tokenHash: hashToken(token), revokedAt: { $exists: false } });
    if (!existing || existing.expiresAt < new Date()) return null;
    const nextToken = randomToken();
    const nextHash = hashToken(nextToken);
    existing.revokedAt = new Date();
    existing.replacedByTokenHash = nextHash;
    await existing.save();
    await RefreshToken.create({
      userId: existing.userId,
      tokenHash: nextHash,
      expiresAt: new Date(Date.now() + durationToMs(env.JWT_REFRESH_EXPIRES_IN)),
      ip: meta.ip,
      userAgent: meta.userAgent
    });
    return { userId: existing.userId.toString(), refreshToken: nextToken };
  }

  static async revoke(token: string) {
    await RefreshToken.updateOne({ tokenHash: hashToken(token) }, { $set: { revokedAt: new Date() } });
  }
}
