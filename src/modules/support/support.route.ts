import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { upload } from '../../middlewares/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { StorageService } from '../../services/StorageService';
import { SupportIssue } from './support-issue.model';
import { FeatureRequest } from './feature-request.model';

export const supportRouter = Router();
supportRouter.use(requireAuth);

supportRouter.post('/support/issues', upload.array('attachments', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const attachments = await Promise.all(files.map((file) => StorageService.uploadBuffer(`support/${req.user!._id}`, file)));
  const issue = await SupportIssue.create({ ...req.body, userId: req.user!._id, attachments });
  ok(res, 'Support issue submitted', issue, 201);
}));

supportRouter.post('/support/feature-requests', upload.array('images', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const images = await Promise.all(files.map((file) => StorageService.uploadBuffer(`feature-requests/${req.user!._id}`, file)));
  const feature = await FeatureRequest.create({ ...req.body, userId: req.user!._id, images });
  ok(res, 'Feature request submitted', feature, 201);
}));

supportRouter.post('/feature-requests', upload.array('images', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const images = await Promise.all(files.map((file) => StorageService.uploadBuffer(`feature-requests/${req.user!._id}`, file)));
  const feature = await FeatureRequest.create({ ...req.body, userId: req.user!._id, images });
  ok(res, 'Feature request submitted', feature, 201);
}));
