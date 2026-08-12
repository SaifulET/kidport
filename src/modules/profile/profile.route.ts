import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { StorageService } from '../../services/StorageService';
import { AccessibleChildrenService } from '../../services/AccessibleChildrenService';
import { Observation } from '../observations/observation.model';

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/', asyncHandler(async (req, res) => ok(res, 'Profile', req.user)));

profileRouter.get('/stats', asyncHandler(async (req, res) => {
  const childIds = await AccessibleChildrenService.idsForUser(req.user!._id.toString());
  if (childIds.length === 0) {
    ok(res, 'Caregiver stats', { totalObservations: 0, totalMilestones: 0, associatedChildren: 0 });
    return;
  }

  const filter = { childId: { $in: childIds }, status: 'active' };
  const [totalObservations, totalMilestones] = await Promise.all([
    Observation.countDocuments(filter),
    Observation.countDocuments({ ...filter, isMilestone: true })
  ]);

  ok(res, 'Caregiver stats', {
    totalObservations,
    totalMilestones,
    associatedChildren: childIds.length
  });
}));

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
    ok(res, 'Profile photo updated', { profileImage: req.user!.profilePhoto.url });
  })
);
