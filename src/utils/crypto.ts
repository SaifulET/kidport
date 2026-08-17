import crypto from 'crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const randomOtp = () => crypto.randomInt(0, 10000).toString().padStart(4, '0');
