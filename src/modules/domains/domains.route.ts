import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, paginated } from '../../utils/apiResponse';
import { paginationFromQuery } from '../../utils/pagination';
import { NotificationService } from '../../services/NotificationService';
import { DevelopmentDomain } from './development-domain.model';
import { DevelopmentIndicator } from './development-indicator.model';
import { AgeBand } from './age-band.model';

export const domainsRouter = Router();
domainsRouter.use(requireAuth);

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

domainsRouter.get('/domains', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { status: 'active' };
  const [total, domains] = await Promise.all([
    DevelopmentDomain.countDocuments(filter),
    DevelopmentDomain.find(filter).sort({ sortOrder: 1 }).skip(skip).limit(limit)
  ]);
  paginated(res, 'Development domains', domains, page, limit, total);
}));
domainsRouter.post(
  '/domains',
  validate(z.object({ body: z.object({ name: z.string().min(1) }) })),
  asyncHandler(async (req, res) => {
    const name = req.body.name.trim();
    const domain = await DevelopmentDomain.create({ name, slug: slugify(name) });
    void NotificationService.createDomainCreatedNotifications(domain._id.toString(), domain.name, req.user!._id.toString()).catch(() => {});
    ok(res, 'Domain created', domain, 201);
  })
);
domainsRouter.patch('/domains/:domainId', asyncHandler(async (req, res) => ok(res, 'Domain updated', await DevelopmentDomain.findByIdAndUpdate(req.params.domainId, { $set: req.body }, { new: true }))));

domainsRouter.get('/age-bands', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { status: 'active' };
  const [total, ageBands] = await Promise.all([
    AgeBand.countDocuments(filter),
    AgeBand.find(filter).sort({ minMonths: 1 }).skip(skip).limit(limit)
  ]);
  paginated(res, 'Age bands', ageBands, page, limit, total);
}));
domainsRouter.post('/age-bands', asyncHandler(async (req, res) => ok(res, 'Age band created', await AgeBand.create(req.body), 201)));

domainsRouter.get('/indicators', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter: Record<string, unknown> = { status: 'active' };
  if (req.query.domainId) filter.domainId = req.query.domainId;
  if (req.query.ageBandId) filter.ageBandId = req.query.ageBandId;
  const [total, indicators] = await Promise.all([
    DevelopmentIndicator.countDocuments(filter),
    DevelopmentIndicator.find(filter).skip(skip).limit(limit)
  ]);
  paginated(res, 'Development indicators', indicators, page, limit, total);
}));
domainsRouter.post('/indicators', asyncHandler(async (req, res) => ok(res, 'Indicator created', await DevelopmentIndicator.create(req.body), 201)));
domainsRouter.patch('/indicators/:indicatorId', asyncHandler(async (req, res) => ok(res, 'Indicator updated', await DevelopmentIndicator.findByIdAndUpdate(req.params.indicatorId, { $set: req.body }, { new: true }))));
