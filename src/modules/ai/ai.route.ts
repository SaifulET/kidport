import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess } from '../../middlewares/authorization';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { ReportService } from '../../services/ReportService';

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.post('/ai/children/:childId/report-analysis/regenerate', requireChildAccess(), asyncHandler(async (req, res) => {
  ok(res, 'AI report analysis regenerated', await ReportService.developmentReport(req.params.childId, {}, true));
}));
