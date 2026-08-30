import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess } from '../../middlewares/authorization';
import { isAllowedUploadMimeType, MAX_UPLOAD_FILE_SIZE_BYTES, upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { ok } from '../../utils/apiResponse';
import { paginationFromQuery } from '../../utils/pagination';
import { AuthorizationService } from '../../services/AuthorizationService';
import { ObservationService } from '../../services/ObservationService';
import { SocialResponseService } from '../../services/SocialResponseService';
import { StorageService, type StoredMedia } from '../../services/StorageService';
import { Reaction } from '../reactions/reaction.model';
import { Comment } from '../comments/comment.model';
import { Observation } from './observation.model';

export const observationsRouter = Router();
observationsRouter.use(requireAuth);

const cleanString = (value: unknown) =>
  typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : value;

const stageSchema = z.preprocess(cleanString, z.enum(['emerging', 'building', 'steady', 'confident']));
const statusSchema = z.preprocess(cleanString, z.enum(['active', 'draft']));
const observationTypeSchema = z.enum(['text', 'voice', 'photo', 'video']);
const storedMediaSchema = z.object({
  key: z.preprocess(cleanString, z.string().min(1)),
  mimeType: z.preprocess(cleanString, z.string().min(1)),
  size: z.coerce.number().int().nonnegative(),
  originalName: z.preprocess(cleanString, z.string().min(1)).optional()
});

const createSchema = z.object({
  body: z
    .object({
      type: observationTypeSchema.optional(),
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
      occurredAt: z.coerce.date().optional(),
      status: statusSchema.optional(),
      media: z.array(storedMediaSchema).max(5).optional()
    })
    .superRefine((body, ctx) => {
      if (body.status === 'draft') return;
      if (!body.keyword && !body.stage) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keyword'], message: 'Keyword is required' });
      if (!body.domain && !body.domainId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['domain'], message: 'Domain is required' });
    })
});

const uploadUrlSchema = z.object({
  body: z.object({
    fileName: z.preprocess(cleanString, z.string().min(1)),
    contentType: z.preprocess(cleanString, z.string().min(1)),
    size: z.coerce.number().int().nonnegative().optional(),
    type: observationTypeSchema.exclude(['text']).optional()
  })
});

const updateSchema = z.object({
  body: z
    .object({
      type: observationTypeSchema.optional(),
      observation: z.preprocess(cleanString, z.string()).optional(),
      text: z.preprocess(cleanString, z.string()).optional(),
      domain: z.preprocess(cleanString, z.string()).optional(),
      domainId: z.preprocess(cleanString, z.string()).optional(),
      indicatorId: z.string().optional(),
      keyword: stageSchema.optional(),
      stage: stageSchema.optional(),
      mood: z.string().optional(),
      occurredAt: z.coerce.date().optional(),
      status: statusSchema.optional()
    })
    .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'At least one field is required' })
});

const inferObservationType = (type: string | undefined, files: Express.Multer.File[] = [], media: StoredMedia[] = []) => {
  if (type) return type as 'text' | 'voice' | 'photo' | 'video';
  const mime = files[0]?.mimetype ?? media[0]?.mimeType;
  if (mime?.startsWith('image/')) return 'photo';
  if (mime?.startsWith('audio/')) return 'voice';
  if (mime?.startsWith('video/')) return 'video';
  return 'text';
};

const shouldReact = (value: unknown) => value === true || value === 'true' || value === 'love';

const currentAuthorRelationship = (user: Express.Request['user']) =>
  user?.userType === 'daycare' ? 'daycare' : 'caregiver';

const observationStatus = (value: unknown) => {
  const status = cleanString(value);
  if (status === undefined) return undefined;
  if (status === 'active' || status === 'draft') return status;
  throw new AppError('Status must be active or draft', 400);
};

const observationCard = async (observationId: unknown) => {
  const observation = await Observation.findById(observationId)
    .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name slug title')
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType');
  if (!observation) return null;
  const counts = await SocialResponseService.observationCountMaps([observation._id]);
  return SocialResponseService.observation(observation, counts);
};

const observationMediaFolder = (type: 'text' | 'voice' | 'photo' | 'video') =>
  type === 'voice' ? 'audio' : type === 'video' ? 'videos' : type === 'photo' ? 'images' : 'files';

const assertAllowedMedia = (mimeType: string, size?: number) => {
  const normalized = mimeType.toLowerCase();
  if (!isAllowedUploadMimeType(normalized)) throw new AppError('Unsupported file type', 400);
  if (size !== undefined && size > MAX_UPLOAD_FILE_SIZE_BYTES) throw new AppError('Uploaded file is too large', 413);
  return normalized;
};

const normalizeStoredObservationMedia = async (childId: string, media: z.infer<typeof storedMediaSchema>[] = []): Promise<StoredMedia[]> => {
  const prefix = `children/${childId}/observations/`;
  return Promise.all(
    media.map(async (item) => {
      if (!item.key.startsWith(prefix)) throw new AppError('Uploaded media does not belong to this child', 400);
      const requestedMimeType = assertAllowedMedia(item.mimeType, item.size);

      let metadata: Awaited<ReturnType<typeof StorageService.objectMetadata>>;
      try {
        metadata = await StorageService.objectMetadata(item.key);
      } catch (_error) {
        throw new AppError('Uploaded media was not found. Upload it before creating the observation.', 400);
      }

      const storedMimeType = metadata.mimeType?.toLowerCase() ?? requestedMimeType;
      assertAllowedMedia(storedMimeType, metadata.size ?? item.size);
      return {
        key: item.key,
        url: StorageService.publicUrl(item.key),
        mimeType: storedMimeType,
        size: metadata.size ?? item.size,
        originalName: item.originalName
      };
    })
  );
};

observationsRouter.post('/children/:childId/observations/media-upload-url', requireChildAccess(), validate(uploadUrlSchema), asyncHandler(async (req, res) => {
  const contentType = assertAllowedMedia(req.body.contentType, req.body.size);
  const type = inferObservationType(req.body.type, [{ mimetype: contentType } as Express.Multer.File]);
  const key = StorageService.objectKey(`children/${req.params.childId}/observations/${observationMediaFolder(type)}`, req.body.fileName);
  const uploadUrl = await StorageService.presignedPutUrl(key, contentType);
  const media: StoredMedia = {
    key,
    url: StorageService.publicUrl(key),
    mimeType: contentType,
    size: req.body.size ?? 0,
    originalName: req.body.fileName
  };

  ok(res, 'Observation media upload URL created', {
    method: 'PUT',
    url: uploadUrl,
    headers: { 'Content-Type': contentType },
    expiresInSeconds: 600,
    media
  });
}));

observationsRouter.post('/children/:childId/observations', requireChildAccess(), upload.fields([{ name: 'media', maxCount: 5 }, { name: 'observation', maxCount: 5 }]), validate(createSchema), asyncHandler(async (req, res) => {
  const uploadedFiles = req.files as Record<string, Express.Multer.File[]> | undefined;
  const files = [...(uploadedFiles?.media ?? []), ...(uploadedFiles?.observation ?? [])];
  const storedMedia = await normalizeStoredObservationMedia(req.params.childId, req.body.media);
  const status = observationStatus(req.body.status);
  if (status !== 'draft' && !req.body.observation && !req.body.text && files.length === 0 && storedMedia.length === 0) {
    throw new AppError('Observation text or media is required', 400);
  }
  const observation = await ObservationService.create({
    childId: req.params.childId,
    authorId: req.user!._id.toString(),
    authorRelationship: currentAuthorRelationship(req.user),
    daycareId: req.childAccess?.daycareId,
    type: inferObservationType(req.body.type, files, storedMedia),
    text: req.body.observation ?? req.body.text,
    domainId: req.body.domain ?? req.body.domainId,
    indicatorId: req.body.indicatorId,
    stage: req.body.keyword ?? req.body.stage,
    mood: req.body.mood,
    occurredAt: req.body.occurredAt,
    files,
    storedMedia,
    status
  });
  if (status !== 'draft' && shouldReact(req.body.react ?? req.body.reaction)) {
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
    const status = observationStatus(req.body.status);
    const observation = await ObservationService.create({
      childId: req.params.childId,
      authorId: req.user!._id.toString(),
      authorRelationship: currentAuthorRelationship(req.user),
      daycareId: req.childAccess?.daycareId,
      type,
      text: req.body.text,
      domainId: req.body.domainId,
      indicatorId: req.body.indicatorId,
      stage: req.body.stage,
      mood: req.body.mood,
      occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : undefined,
      files: req.files as Express.Multer.File[],
      status
    });
    ok(res, 'Observation created successfully', await observationCard(observation._id), 201);
  }));
}

observationsRouter.patch('/observations/:observationId', validate(updateSchema), asyncHandler(async (req, res) => {
  const observation = await ObservationService.updateDraft({
    observationId: req.params.observationId,
    userId: req.user!._id.toString(),
    type: req.body.type,
    text: req.body.observation ?? req.body.text,
    domainId: req.body.domain ?? req.body.domainId,
    indicatorId: req.body.indicatorId,
    stage: req.body.keyword ?? req.body.stage,
    mood: req.body.mood,
    occurredAt: req.body.occurredAt,
    status: req.body.status
  });
  ok(res, 'Observation updated successfully', await observationCard(observation._id));
}));

observationsRouter.get('/observations/:observationId', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  if (observation.status === 'draft' && observation.authorId.toString() !== req.user!._id.toString()) {
    throw new AppError('Only the draft author can view this observation', 403);
  }
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);
  ok(res, 'Observation', await observationCard(req.params.observationId));
}));

observationsRouter.get('/observations/:observationId/details', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  if (observation.status === 'draft' && observation.authorId.toString() !== req.user!._id.toString()) {
    throw new AppError('Only the draft author can view this observation', 403);
  }
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);

  const commentFilter = { observationId: observation._id, status: 'active' };
  const [totalComments, comments] = await Promise.all([
    Comment.countDocuments(commentFilter),
    Comment.find(commentFilter)
      .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
  ]);
  const reactionCounts = await SocialResponseService.commentReactionCountMap(comments.map((comment) => comment._id));

  res.json({
    success: true,
    message: 'Observation details',
    data: {
      observation: await observationCard(observation._id),
      totalComments,
      comments: SocialResponseService.comments(comments, reactionCounts)
    },
    pagination: { page, limit, total: totalComments, totalPages: Math.ceil(totalComments / limit) }
  });
}));
