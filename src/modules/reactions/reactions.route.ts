import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import { AuthorizationService } from '../../services/AuthorizationService';
import { SocialResponseService } from '../../services/SocialResponseService';
import { Observation } from '../observations/observation.model';
import { Reaction } from './reaction.model';

export const reactionsRouter = Router();
reactionsRouter.use(requireAuth);

const observationCard = async (observationId: unknown) => {
  const observation = await Observation.findById(observationId)
    .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name title')
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType');
  if (!observation) return null;
  const counts = await SocialResponseService.observationCountMaps([observation._id]);
  return SocialResponseService.observation(observation, counts);
};

reactionsRouter.post('/observations/:observationId/reactions', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);
  await Reaction.findOneAndUpdate(
    { observationId: observation._id, userId: req.user!._id, type: req.body.type ?? 'love' },
    { $setOnInsert: { childId: observation.childId } },
    { upsert: true, new: true }
  );
  ok(res, 'Reaction saved', await observationCard(observation._id), 201);
}));

reactionsRouter.delete('/observations/:observationId/reactions', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);
  await Reaction.deleteOne({ observationId: observation._id, userId: req.user!._id, type: req.body.type ?? 'love' });
  ok(res, 'Reaction removed', await observationCard(observation._id));
}));
