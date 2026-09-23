import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User } from '../modules/users/user.model';
import { AppError } from '../utils/AppError';

type AccessPayload = { sub: string; type: 'access' };

const markObservationTrace = (req: Request, label: string, detail?: Record<string, unknown>) => {
  const trace = (req as any).observationTrace;
  if (!trace) return;
  trace.events.push({
    label,
    ms: Number(process.hrtime.bigint() - trace.startedAt) / 1_000_000,
    detail
  });
};

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  if (req.user && !['disabled', 'rejected', 'deleted'].includes(req.user.status)) {
    markObservationTrace(req, 'requireAuth reused existing user');
    next();
    return;
  }

  markObservationTrace(req, 'requireAuth started');
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new AppError('Authentication required', 401));

  try {
    const jwtStartedAt = process.hrtime.bigint();
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as AccessPayload;
    markObservationTrace(req, 'requireAuth jwt verified', {
      durationMs: Number(process.hrtime.bigint() - jwtStartedAt) / 1_000_000
    });
    if (payload.type !== 'access') throw new Error('Invalid token type');
    const userStartedAt = process.hrtime.bigint();
    const user = await User.findById(payload.sub);
    markObservationTrace(req, 'requireAuth user loaded', {
      durationMs: Number(process.hrtime.bigint() - userStartedAt) / 1_000_000
    });
    if (!user || ['disabled', 'rejected', 'deleted'].includes(user.status)) return next(new AppError('Authentication required', 401));
    req.user = user;
    markObservationTrace(req, 'requireAuth completed');
    next();
  } catch {
    markObservationTrace(req, 'requireAuth failed');
    next(new AppError('Invalid or expired access token', 401));
  }
};
