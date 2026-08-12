import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
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

domainsRouter.get('/domains', asyncHandler(async (_req, res) => ok(res, 'Development domains', await DevelopmentDomain.find({ status: 'active' }).sort({ sortOrder: 1 }))));
domainsRouter.post(
  '/domains',
  validate(z.object({ body: z.object({ name: z.string().min(1) }) })),
  asyncHandler(async (req, res) => {
    const name = req.body.name.trim();
    ok(res, 'Domain created', await DevelopmentDomain.create({ name, slug: slugify(name) }), 201);
  })
);
domainsRouter.patch('/domains/:domainId', asyncHandler(async (req, res) => ok(res, 'Domain updated', await DevelopmentDomain.findByIdAndUpdate(req.params.domainId, { $set: req.body }, { new: true }))));

domainsRouter.get('/age-bands', asyncHandler(async (_req, res) => ok(res, 'Age bands', await AgeBand.find({ status: 'active' }).sort({ minMonths: 1 }))));
domainsRouter.post('/age-bands', asyncHandler(async (req, res) => ok(res, 'Age band created', await AgeBand.create(req.body), 201)));

domainsRouter.get('/indicators', asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { status: 'active' };
  if (req.query.domainId) filter.domainId = req.query.domainId;
  if (req.query.ageBandId) filter.ageBandId = req.query.ageBandId;
  ok(res, 'Development indicators', await DevelopmentIndicator.find(filter));
}));
domainsRouter.post('/indicators', asyncHandler(async (req, res) => ok(res, 'Indicator created', await DevelopmentIndicator.create(req.body), 201)));
domainsRouter.patch('/indicators/:indicatorId', asyncHandler(async (req, res) => ok(res, 'Indicator updated', await DevelopmentIndicator.findByIdAndUpdate(req.params.indicatorId, { $set: req.body }, { new: true }))));
