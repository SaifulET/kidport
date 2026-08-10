import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess } from '../../middlewares/authorization';
import { upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { ObservationService } from '../../services/ObservationService';
import { Observation } from './observation.model';

export const observationsRouter = Router();
observationsRouter.use(requireAuth);

const createSchema = z.object({
  body: z.object({
    type: z.enum(['text', 'voice', 'photo', 'video']),
    text: z.string().optional(),
    domainId: z.string().optional(),
    indicatorId: z.string().optional(),
    stage: z.enum(['emerging', 'building', 'steady', 'confident']).optional(),
    mood: z.string().optional(),
    occurredAt: z.coerce.date().optional()
  })
});

observationsRouter.post('/children/:childId/observations', requireChildAccess(), upload.array('media', 5), validate(createSchema), asyncHandler(async (req, res) => {
  const observation = await ObservationService.create({
    childId: req.params.childId,
    authorId: req.user!._id.toString(),
    type: req.body.type,
    text: req.body.text,
    domainId: req.body.domainId,
    indicatorId: req.body.indicatorId,
    stage: req.body.stage,
    mood: req.body.mood,
    occurredAt: req.body.occurredAt,
    files: req.files as Express.Multer.File[]
  });
  ok(res, 'Observation created successfully', observation, 201);
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
    ok(res, 'Observation created successfully', observation, 201);
  }));
}

observationsRouter.get('/observations/:observationId', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  ok(res, 'Observation', observation);
}));
