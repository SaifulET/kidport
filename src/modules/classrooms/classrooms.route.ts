import { Router } from 'express';
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
import { Daycare } from '../daycare/daycare.model';

export const classroomsRouter = Router();
classroomsRouter.use(requireAuth);

const classroomSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    icon: z.string().optional(),
    theme: z.string().optional(),
    ageBand: z.string().optional(),
    leadTeacher: z.string().optional(),
    description: z.string().optional(),
    capacity: z.number().optional(),
    status: z.enum(['active', 'archived']).optional()
  })
});

const getOwnedDaycareForApprovedUser = async (user: Express.Request['user']) => {
  if (!user) throw new AppError('Authentication required', 401);
  if (user.userType !== 'daycare') throw new AppError('Only daycare accounts can create classrooms', 403);
  if (user.status !== 'active') throw new AppError('Account approval required', 403);

  const daycare = await Daycare.findOne({ ownerId: user._id, status: 'active' }).sort({ createdAt: -1 });
  if (!daycare) throw new AppError('Create your daycare profile before creating classrooms', 404);
  return daycare;
};

classroomsRouter.post('/classroom', validate(classroomSchema), asyncHandler(async (req, res) => {
  const daycare = await getOwnedDaycareForApprovedUser(req.user);
  const classroom = await Classroom.create({ ...req.body, daycareId: daycare._id });
  ok(res, 'Classroom created', classroom, 201);
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
  const assignment = await DaycareChildAssignment.findOne({ childId: req.params.childId, daycareId: classroom.daycareId, status: 'active' });
  if (!assignment) throw new AppError('Child must be assigned to this daycare before classroom placement', 403);
  assignment.classroomId = classroom._id;
  await assignment.save();
  await Child.updateOne({ _id: req.params.childId }, { $set: { daycare: classroom.daycareId, classroom: classroom._id } });
  ok(res, 'Child assigned to classroom', assignment);
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
