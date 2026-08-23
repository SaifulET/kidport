import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { paginated } from '../../utils/apiResponse';
import { paginationFromQuery } from '../../utils/pagination';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get('/reports', (req, res) => {
  const { page, limit } = paginationFromQuery(req.query);
  paginated(res, 'Reports API is available through /children/:childId/reports/*', [], page, limit, 0);
});
