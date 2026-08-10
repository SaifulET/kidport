import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { paginated } from '../../utils/apiResponse';
import { AccessibleChildrenService } from '../../services/AccessibleChildrenService';
import { Observation } from '../observations/observation.model';

export const feedRouter = Router();
feedRouter.use(requireAuth);

feedRouter.get('/feed', asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const childIds = await AccessibleChildrenService.idsForUser(req.user!._id.toString());
  const filter: Record<string, unknown> = { childId: { $in: childIds }, status: 'active' };
  if (req.query.childId) filter.childId = req.query.childId;
  if (req.query.domainId) filter.domainId = req.query.domainId;
  if (req.query.startDate || req.query.endDate) {
    filter.occurredAt = { ...(req.query.startDate ? { $gte: new Date(String(req.query.startDate)) } : {}), ...(req.query.endDate ? { $lte: new Date(String(req.query.endDate)) } : {}) };
  }
  const total = await Observation.countDocuments(filter);
  const items = await Observation.find(filter)
    .populate('childId authorId daycareId domainId indicatorId', 'fullName nickname profilePhoto name title')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  paginated(res, 'Feed', items, page, limit, total);
}));

feedRouter.get('/activity-history', asyncHandler(async (req, res) => {
  req.url = '/feed';
  return undefined;
}));
