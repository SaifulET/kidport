import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireDaycareAccess, requireDaycareAdmin } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import { Classroom } from './classroom.model';
import { DaycareChildAssignment } from '../daycare/daycare-child-assignment.model';
import { Child } from '../children/child.model';
import { DaycareAccountService } from '../../services/DaycareAccountService';
import { Invitation } from '../care-circle/invitation.model';

export const classroomsRouter = Router();
classroomsRouter.use(requireAuth);

const optionalObjectIdSchema = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().refine((value) => Types.ObjectId.isValid(value), 'Must be a valid ObjectId').optional()
);
const objectIdSchema = z.string().refine((value) => Types.ObjectId.isValid(value), 'Must be a valid ObjectId');

const classroomSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    icon: z.string().optional(),
    theme: z.string().optional(),
    ageBand: z.string().optional(),
    leadTeacher: optionalObjectIdSchema,
    description: z.string().optional(),
    capacity: z.number().optional(),
    status: z.enum(['active', 'archived']).optional()
  })
});

const classroomChildrenSchema = z.object({
  body: z
    .object({
      childIds: z.array(objectIdSchema).min(1).optional(),
      children: z.array(objectIdSchema).min(1).optional()
    })
    .refine((body) => body.childIds?.length || body.children?.length, 'childIds is required')
});

const getOwnedDaycareForApprovedUser = async (user: Express.Request['user']) => {
  if (!user) throw new AppError('Authentication required', 401);
  return DaycareAccountService.getApprovedOwnerDaycare(user);
};

classroomsRouter.post('/classroom', validate(classroomSchema), asyncHandler(async (req, res) => {
  const daycare = await getOwnedDaycareForApprovedUser(req.user);
  const classroom = await Classroom.create({ ...req.body, daycareId: daycare._id });
  ok(res, 'Classroom created', classroom, 201);
}));

classroomsRouter.get('/classroom', asyncHandler(async (req, res) => {
  const daycare = await getOwnedDaycareForApprovedUser(req.user);
  ok(res, 'Classrooms', await Classroom.find({ daycareId: daycare._id, status: 'active' }));
}));

classroomsRouter.post('/daycares/:daycareId/classrooms', requireDaycareAdmin(), validate(classroomSchema), asyncHandler(async (req, res) => {
  const classroom = await Classroom.create({ ...req.body, daycareId: req.params.daycareId });
  ok(res, 'Classroom created', classroom, 201);
}));

classroomsRouter.get('/daycares/:daycareId/classrooms', requireDaycareAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Classrooms', await Classroom.find({ daycareId: req.params.daycareId, status: 'active' }));
}));

classroomsRouter.get('/classrooms/:classroomId', asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.classroomId);
  if (!classroom) throw new AppError('Classroom not found', 404);
  await requireDaycareAccess('daycareId')({ ...req, params: { daycareId: classroom.daycareId.toString() } } as never, res, () => undefined);
  ok(res, 'Classroom', classroom);
}));

classroomsRouter.patch('/classrooms/:classroomId', asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.classroomId);
  if (!classroom) throw new AppError('Classroom not found', 404);
  const admin = await import('../../services/AuthorizationService').then((m) => m.AuthorizationService.canManageDaycare(req.user!._id.toString(), classroom.daycareId.toString()));
  if (!admin) throw new AppError('Daycare administrator permission required', 403);
  ok(res, 'Classroom updated', await Classroom.findByIdAndUpdate(req.params.classroomId, { $set: req.body }, { new: true }));
}));

classroomsRouter.delete('/classrooms/:classroomId', asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.classroomId);
  if (!classroom) throw new AppError('Classroom not found', 404);
  const admin = await import('../../services/AuthorizationService').then((m) => m.AuthorizationService.canManageDaycare(req.user!._id.toString(), classroom.daycareId.toString()));
  if (!admin) throw new AppError('Daycare administrator permission required', 403);
  await Classroom.updateOne({ _id: req.params.classroomId }, { $set: { status: 'archived' } });
  ok(res, 'Classroom archived');
}));

classroomsRouter.post('/classrooms/:classroomId/children/:childId', asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.classroomId);
  if (!classroom) throw new AppError('Classroom not found', 404);
  const member = await import('../../services/AuthorizationService').then((m) => m.AuthorizationService.canAccessDaycare(req.user!._id.toString(), classroom.daycareId.toString()));
  if (!member) throw new AppError('You do not have access to this daycare', 403);
  const assignment = await DaycareChildAssignment.findOne({
    childId: req.params.childId,
    daycareId: classroom.daycareId,
    status: { $in: ['pending', 'active'] }
  });
  if (!assignment) throw new AppError('Child must be assigned to this daycare before classroom placement', 403);
  assignment.classroomId = classroom._id;
  assignment.status = 'active';
  assignment.acceptedBy = req.user!._id;
  assignment.acceptedAt = new Date();
  await assignment.save();
  await Invitation.updateOne(
    { type: 'daycare_child_assignment', childId: req.params.childId, daycareId: classroom.daycareId, status: 'pending' },
    { $set: { status: 'accepted', acceptedBy: req.user!._id, acceptedAt: new Date() } }
  );
  await Child.updateOne({ _id: req.params.childId }, { $set: { daycare: classroom.daycareId, classroom: classroom._id } });
  ok(res, 'Child assigned to classroom', assignment);
}));

classroomsRouter.post('/classroom/:classroomId/children', validate(classroomChildrenSchema), asyncHandler(async (req, res) => {
  const daycare = await getOwnedDaycareForApprovedUser(req.user);
  const classroom = await Classroom.findOne({ _id: req.params.classroomId, daycareId: daycare._id, status: 'active' });
  if (!classroom) throw new AppError('Classroom not found for this daycare', 404);

  const childIds = [...new Set([...(req.body.childIds ?? req.body.children)].map(String))];
  const assignments = await DaycareChildAssignment.find({
    daycareId: daycare._id,
    childId: { $in: childIds },
    status: { $in: ['pending', 'active'] }
  });

  const assignedChildIds = new Set(assignments.map((assignment) => assignment.childId.toString()));
  const missingChildIds = childIds.filter((childId) => !assignedChildIds.has(childId));
  if (missingChildIds.length) {
    throw new AppError('Children must be assigned to this daycare before classroom placement', 403, missingChildIds);
  }

  await DaycareChildAssignment.updateMany(
    { daycareId: daycare._id, childId: { $in: childIds }, status: { $in: ['pending', 'active'] } },
    { $set: { classroomId: classroom._id, status: 'active', acceptedBy: req.user!._id, acceptedAt: new Date() } }
  );
  await Invitation.updateMany(
    { type: 'daycare_child_assignment', daycareId: daycare._id, childId: { $in: childIds }, status: 'pending' },
    { $set: { status: 'accepted', acceptedBy: req.user!._id, acceptedAt: new Date() } }
  );
  await Child.updateMany(
    { _id: { $in: childIds }, status: { $ne: 'deleted' } },
    { $set: { daycare: daycare._id, classroom: classroom._id } }
  );

  ok(res, 'Children assigned to classroom', {
    daycareId: daycare._id,
    classroomId: classroom._id,
    childIds,
    assignedCount: childIds.length
  });
}));

classroomsRouter.delete('/classrooms/:classroomId/children/:childId', asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.classroomId);
  if (!classroom) throw new AppError('Classroom not found', 404);
  const member = await import('../../services/AuthorizationService').then((m) => m.AuthorizationService.canAccessDaycare(req.user!._id.toString(), classroom.daycareId.toString()));
  if (!member) throw new AppError('You do not have access to this daycare', 403);
  await DaycareChildAssignment.updateOne({ childId: req.params.childId, daycareId: classroom.daycareId }, { $unset: { classroomId: '' } });
  await Child.updateOne({ _id: req.params.childId, classroom: classroom._id }, { $unset: { classroom: '' } });
  ok(res, 'Child removed from classroom');
}));
