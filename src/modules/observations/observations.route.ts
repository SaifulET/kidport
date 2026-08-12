import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess } from '../../middlewares/authorization';
import { upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { ok } from '../../utils/apiResponse';
import { AuthorizationService } from '../../services/AuthorizationService';
import { ObservationService } from '../../services/ObservationService';
import { SocialResponseService } from '../../services/SocialResponseService';
import { Reaction } from '../reactions/reaction.model';
import { Comment } from '../comments/comment.model';
import { Observation } from './observation.model';

export const observationsRouter = Router();
observationsRouter.use(requireAuth);

const cleanString = (value: unknown) =>
  typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : value;

const stageSchema = z.preprocess(cleanString, z.enum(['emerging', 'building', 'steady', 'confident']));

const createSchema = z.object({
  body: z
    .object({
      type: z.enum(['text', 'voice', 'photo', 'video']).optional(),
      observation: z.preprocess(cleanString, z.string()).optional(),
      text: z.preprocess(cleanString, z.string()).optional(),
      domain: z.preprocess(cleanString, z.string()).optional(),
      domainId: z.preprocess(cleanString, z.string()).optional(),
      indicatorId: z.string().optional(),
      keyword: stageSchema.optional(),
      stage: stageSchema.optional(),
      react: z.preprocess(cleanString, z.string()).optional(),
      reaction: z.preprocess(cleanString, z.string()).optional(),
      mood: z.string().optional(),
      occurredAt: z.coerce.date().optional()
    })
    .superRefine((body, ctx) => {
      if (!body.keyword && !body.stage) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keyword'], message: 'Keyword is required' });
      if (!body.domain && !body.domainId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['domain'], message: 'Domain is required' });
    })
});

const inferObservationType = (type: string | undefined, files: Express.Multer.File[]) => {
  if (type) return type as 'text' | 'voice' | 'photo' | 'video';
  const mime = files[0]?.mimetype;
  if (mime?.startsWith('image/')) return 'photo';
  if (mime?.startsWith('audio/')) return 'voice';
  if (mime?.startsWith('video/')) return 'video';
  return 'text';
};

const shouldReact = (value: unknown) => value === true || value === 'true' || value === 'love';

const observationCard = async (observationId: unknown) => {
  const observation = await Observation.findById(observationId)
    .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name title')
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType');
  if (!observation) return null;
  const counts = await SocialResponseService.observationCountMaps([observation._id]);
  return SocialResponseService.observation(observation, counts);
};

observationsRouter.post('/children/:childId/observations', requireChildAccess(), upload.fields([{ name: 'media', maxCount: 5 }, { name: 'observation', maxCount: 5 }]), validate(createSchema), asyncHandler(async (req, res) => {
  const uploadedFiles = req.files as Record<string, Express.Multer.File[]> | undefined;
  const files = [...(uploadedFiles?.media ?? []), ...(uploadedFiles?.observation ?? [])];
  if (!req.body.observation && !req.body.text && files.length === 0) {
    throw new AppError('Observation text or media is required', 400);
  }
  const observation = await ObservationService.create({
    childId: req.params.childId,
    authorId: req.user!._id.toString(),
    type: inferObservationType(req.body.type, files),
    text: req.body.observation ?? req.body.text,
    domainId: req.body.domain ?? req.body.domainId,
    indicatorId: req.body.indicatorId,
    stage: req.body.keyword ?? req.body.stage,
    mood: req.body.mood,
    occurredAt: req.body.occurredAt,
    files
  });
  if (shouldReact(req.body.react ?? req.body.reaction)) {
    await Reaction.findOneAndUpdate(
      { observationId: observation._id, userId: req.user!._id, type: 'love' },
      { $setOnInsert: { childId: observation.childId } },
      { upsert: true, new: true }
    );
  }
  ok(res, 'Observation created successfully', await observationCard(observation._id), 201);
}));

for (const type of ['text', 'voice', 'photo', 'video'] as const) {
  observationsRouter.post(`/children/:childId/observations/${type}`, requireChildAccess(), upload.array('media', 5), asyncHandler(async (req, res) => {
    const observation = await ObservationService.create({
      childId: req.params.childId,
      authorId: req.user!._id.toString(),
      type,
      text: req.body.text,
      domainId: req.body.domainId,
      indicatorId: req.body.indicatorId,
      stage: req.body.stage,
      mood: req.body.mood,
      occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : undefined,
      files: req.files as Express.Multer.File[]
    });
    ok(res, 'Observation created successfully', await observationCard(observation._id), 201);
  }));
}

observationsRouter.get('/observations/:observationId', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);
  ok(res, 'Observation', await observationCard(req.params.observationId));
}));

observationsRouter.get('/observations/:observationId/details', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);

  const comments = await Comment.find({ observationId: observation._id, status: 'active' })
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
    .sort({ createdAt: 1 });
  const reactionCounts = await SocialResponseService.commentReactionCountMap(comments.map((comment) => comment._id));

  ok(res, 'Observation details', {
    observation: await observationCard(observation._id),
    totalComments: comments.length,
    comments: SocialResponseService.comments(comments, reactionCounts)
  });
}));
