import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User } from '../modules/users/user.model';
import { AppError } from '../utils/AppError';

type AccessPayload = { sub: string; type: 'access' };

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new AppError('Authentication required', 401));

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as AccessPayload;
    if (payload.type !== 'access') throw new Error('Invalid token type');
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') return next(new AppError('Authentication required', 401));
    req.user = user;
    next();
  } catch {
    next(new AppError('Invalid or expired access token', 401));
  }
};
