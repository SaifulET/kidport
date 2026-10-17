import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { TokenService } from '../src/services/TokenService';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('TokenService refresh rotation', () => {
  it('rotates an active refresh token', async () => {
    const userId = new mongoose.Types.ObjectId();
    const token = await TokenService.issueRefreshToken(userId, {});
    const rotated = await TokenService.rotateRefreshToken(token, {});

    expect(rotated?.userId).toBe(userId.toString());
    expect(rotated?.refreshToken).toBeTruthy();
    expect(rotated?.refreshToken).not.toBe(token);
    expect(await RefreshToken.countDocuments({ userId, revokedAt: { $exists: true } })).toBe(1);
  });

  it('allows a recently rotated refresh token to be reused within the grace window', async () => {
    const userId = new mongoose.Types.ObjectId();
    const token = await TokenService.issueRefreshToken(userId, {});
    const first = await TokenService.rotateRefreshToken(token, {});
    const reused = await TokenService.rotateRefreshToken(token, {});

    expect(first?.refreshToken).toBeTruthy();
    expect(reused?.refreshToken).toBeTruthy();
    expect(reused?.refreshToken).not.toBe(first?.refreshToken);
    expect(reused?.userId).toBe(userId.toString());
  });

  it('rejects a rotated refresh token after the grace window', async () => {
    const userId = new mongoose.Types.ObjectId();
    const token = await TokenService.issueRefreshToken(userId, {});
    await TokenService.rotateRefreshToken(token, {});

    const stored = await RefreshToken.findOne({ revokedAt: { $exists: true } });
    stored!.revokedAt = new Date(Date.now() - TokenService.REFRESH_REUSE_WINDOW_MS - 1000);
    await stored!.save();

    await expect(TokenService.rotateRefreshToken(token, {})).resolves.toBeNull();
  });
});
