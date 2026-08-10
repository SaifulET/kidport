import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { ok } from '../../utils/apiResponse';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get('/reports', (_req, res) => ok(res, 'Reports API is available through /children/:childId/reports/*', []));
