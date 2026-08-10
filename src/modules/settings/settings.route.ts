import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { UserSettings } from './user-settings.model';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await UserSettings.findOneAndUpdate({ userId: req.user!._id }, { $setOnInsert: { userId: req.user!._id } }, { upsert: true, new: true });
    ok(res, 'Settings', settings);
  })
);

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await UserSettings.findOneAndUpdate({ userId: req.user!._id }, { $set: req.body }, { upsert: true, new: true });
    ok(res, 'Settings updated', settings);
  })
);

settingsRouter.delete(
  '/account',
  asyncHandler(async (req, res) => {
    req.user!.status = 'deleted';
    req.user!.deletedAt = new Date();
    await req.user!.save();
    ok(res, 'Account deleted');
  })
);
