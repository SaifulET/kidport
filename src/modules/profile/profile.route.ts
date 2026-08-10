import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { StorageService } from '../../services/StorageService';

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/', asyncHandler(async (req, res) => ok(res, 'Profile', req.user)));

profileRouter.patch(
  '/',
  validate(z.object({ body: z.object({ fullName: z.string().min(1).optional(), phoneNumber: z.string().optional(), bio: z.string().optional() }) })),
  asyncHandler(async (req, res) => {
    Object.assign(req.user!, req.body);
    await req.user!.save();
    ok(res, 'Profile updated', req.user);
  })
);

profileRouter.patch(
  '/photo',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new Error('Photo is required');
    req.user!.profilePhoto = await StorageService.uploadBuffer(`users/${req.user!._id}/profile`, req.file);
    await req.user!.save();
    ok(res, 'Profile photo updated', req.user!.profilePhoto);
  })
);
