import crypto from 'crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
