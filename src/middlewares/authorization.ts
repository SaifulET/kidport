import type { NextFunction, Request, Response } from 'express';
import { AuthorizationService } from '../services/AuthorizationService';
import { AppError } from '../utils/AppError';

export const requireChildAccess = (paramName = 'childId') => async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  const childId = req.params[paramName];
  const access = await AuthorizationService.getChildAccess(req.user._id.toString(), childId);
  if (!access) return next(new AppError('You do not have access to this child', 403));
  req.childAccess = { childId, daycareId: access.daycareId, isOwner: access.isOwner };
  next();
};

export const requireChildOwner = (paramName = 'childId') => async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  const childId = req.params[paramName];
  const access = await AuthorizationService.getChildAccess(req.user._id.toString(), childId);
  if (!access?.isOwner) return next(new AppError('Child owner permission required', 403));
  req.childAccess = { childId, daycareId: access.daycareId, isOwner: true };
  next();
};

export const requireDaycareAccess = (paramName = 'daycareId') => async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  const member = await AuthorizationService.canAccessDaycare(req.user._id.toString(), req.params[paramName]);
  if (!member) return next(new AppError('You do not have access to this daycare', 403));
  next();
};

export const requireDaycareAdmin = (paramName = 'daycareId') => async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  const allowed = await AuthorizationService.canManageDaycare(req.user._id.toString(), req.params[paramName]);
  if (!allowed) return next(new AppError('Daycare administrator permission required', 403));
  next();
};
