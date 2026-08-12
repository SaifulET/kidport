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
    const update: Record<string, unknown> = {};
    const { notifications, ...settings } = req.body;

    Object.entries(settings).forEach(([key, value]) => {
      if (value !== undefined) update[key] = value;
    });

    if (notifications && typeof notifications === 'object' && !Array.isArray(notifications)) {
      Object.entries(notifications).forEach(([key, value]) => {
        if (value !== undefined) update[`notifications.${key}`] = value;
      });
    }

    const settingsDoc = await UserSettings.findOneAndUpdate(
      { userId: req.user!._id },
      { $set: update, $setOnInsert: { userId: req.user!._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    ok(res, 'Settings updated', settingsDoc);
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
