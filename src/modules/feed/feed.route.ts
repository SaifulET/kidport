import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { paginated } from '../../utils/apiResponse';
import { AccessibleChildrenService } from '../../services/AccessibleChildrenService';
import { SocialResponseService } from '../../services/SocialResponseService';
import { Observation } from '../observations/observation.model';

export const feedRouter = Router();
feedRouter.use(requireAuth);

const visibleObservationStatusFilter = (authorId: unknown) => ({
  $or: [{ status: 'active' }, { status: 'draft', authorId }]
});

const listAccessibleObservations = (message: string) => asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const childIds = await AccessibleChildrenService.idsForUser(req.user!._id.toString());
  const requestedChildId = typeof req.query.childId === 'string' ? req.query.childId : undefined;
  if (requestedChildId && !childIds.map(String).includes(requestedChildId)) {
    paginated(res, message, [], page, limit, 0);
    return;
  }

  const filter: Record<string, unknown> = {
    childId: requestedChildId ?? { $in: childIds },
    ...visibleObservationStatusFilter(req.user!._id)
  };
  if (req.query.domainId) filter.domainId = req.query.domainId;
  if (req.query.startDate || req.query.endDate) {
    filter.occurredAt = { ...(req.query.startDate ? { $gte: new Date(String(req.query.startDate)) } : {}), ...(req.query.endDate ? { $lte: new Date(String(req.query.endDate)) } : {}) };
  }
  const total = await Observation.countDocuments(filter);
  const items = await Observation.find(filter)
    .populate('childId daycareId domainId indicatorId', 'fullName nickname profilePhoto name title')
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const counts = await SocialResponseService.observationCountMaps(items.map((item) => item._id));
  paginated(res, message, SocialResponseService.observations(items, counts), page, limit, total);
});

feedRouter.get('/feed', listAccessibleObservations('Feed'));
feedRouter.get('/activity-history', listAccessibleObservations('Activity history'));
