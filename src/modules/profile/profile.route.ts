import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { ok } from '../../utils/apiResponse';
import { StorageService } from '../../services/StorageService';
import { AccessibleChildrenService } from '../../services/AccessibleChildrenService';
import { Observation } from '../observations/observation.model';

export const profileRouter = Router();
profileRouter.use(requireAuth);

const profileFields = (body: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries({
      fullName: body.fullName,
      phoneNumber: body.phoneNumber,
      bio: body.bio
    }).filter(([, value]) => value !== undefined)
  );

const ensureProfilePhoto = (file?: Express.Multer.File) => {
  if (file && !file.mimetype.startsWith('image/')) throw new AppError('Profile photo must be an image', 400);
};

const caregiverStats = async (userId: string, authorId: unknown) => {
  const childIds = await AccessibleChildrenService.idsForUser(userId);
  const activeAssociatedChildren = childIds.length;
  if (childIds.length === 0) {
    return { totalObservations: 0, totalObservationsGiven: 0, totalMilestones: 0, associatedChildren: 0 };
  }

  const filter = { childId: { $in: childIds }, status: 'active' };
  const [totalObservations, totalObservationsGiven, totalMilestones] = await Promise.all([
    Observation.countDocuments(filter),
    Observation.countDocuments({ ...filter, authorId }),
    Observation.countDocuments({ ...filter, isMilestone: true })
  ]);

  return {
    totalObservations,
    totalObservationsGiven,
    totalMilestones,
    associatedChildren: activeAssociatedChildren
  };
};

profileRouter.get('/', asyncHandler(async (req, res) => {
  const stats = await caregiverStats(req.user!._id.toString(), req.user!._id);
  ok(res, 'Profile', { ...req.user!.toObject(), stats });
}));

profileRouter.get('/stats', asyncHandler(async (req, res) => {
  ok(res, 'Caregiver stats', await caregiverStats(req.user!._id.toString(), req.user!._id));
}));

profileRouter.patch(
  '/',
  upload.single('photo'),
  validate(z.object({ body: z.object({ fullName: z.string().min(1).optional(), phoneNumber: z.string().optional(), bio: z.string().optional() }) })),
  asyncHandler(async (req, res) => {
    ensureProfilePhoto(req.file);
    Object.assign(req.user!, profileFields(req.body));
    if (req.file) req.user!.profilePhoto = await StorageService.uploadBuffer(`users/${req.user!._id}/profile`, req.file);
    await req.user!.save();
    ok(res, 'Profile updated', req.user);
  })
);

profileRouter.patch(
  '/photo',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new Error('Photo is required');
    ensureProfilePhoto(req.file);
    req.user!.profilePhoto = await StorageService.uploadBuffer(`users/${req.user!._id}/profile`, req.file);
    await req.user!.save();
    ok(res, 'Profile photo updated', { profileImage: req.user!.profilePhoto.url });
  })
);
