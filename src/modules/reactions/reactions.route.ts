import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import { AuthorizationService } from '../../services/AuthorizationService';
import { Observation } from '../observations/observation.model';
import { Reaction } from './reaction.model';

export const reactionsRouter = Router();
reactionsRouter.use(requireAuth);

reactionsRouter.post('/observations/:observationId/reactions', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);
  const reaction = await Reaction.findOneAndUpdate(
    { observationId: observation._id, userId: req.user!._id, type: req.body.type ?? 'love' },
    { $setOnInsert: { childId: observation.childId } },
    { upsert: true, new: true }
  );
  ok(res, 'Reaction saved', reaction, 201);
}));

reactionsRouter.delete('/observations/:observationId/reactions', asyncHandler(async (req, res) => {
  await Reaction.deleteOne({ observationId: req.params.observationId, userId: req.user!._id, type: req.body.type ?? 'love' });
  ok(res, 'Reaction removed');
}));
