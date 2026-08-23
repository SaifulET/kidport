import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireDaycareAccess, requireDaycareAdmin } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, paginated } from '../../utils/apiResponse';
import { paginationFromQuery } from '../../utils/pagination';
import { AppError } from '../../utils/AppError';
import { Classroom } from './classroom.model';
import { DaycareChildAssignment } from '../daycare/daycare-child-assignment.model';
import { Child } from '../children/child.model';
import { Daycare } from '../daycare/daycare.model';
import { Observation } from '../observations/observation.model';
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

const childIdsFromBody = (body: { childIds?: string[]; children?: string[] }) =>
  [...new Set([...(body.childIds ?? body.children ?? [])].map(String))];

const classroomChildResponse = (child: InstanceType<typeof Child>) => {
  const data = child.toObject();
  const { profilePhoto: _profilePhoto, ...rest } = data;
  return {
    ...rest,
    profileImage: child.profilePhoto?.url
  };
};

const classroomDetailsResponse = async (
  classroom: InstanceType<typeof Classroom>,
  pagination: ReturnType<typeof paginationFromQuery>
) => {
  const [daycare, assignments] = await Promise.all([
    Daycare.findById(classroom.daycareId).select('name'),
    DaycareChildAssignment.find({
      daycareId: classroom.daycareId,
      classroomId: classroom._id,
      status: 'active'
    }).select('childId')
  ]);
  const assignmentChildIds = assignments.map((assignment) => assignment.childId);
  const childFilter = {
    status: { $ne: 'deleted' },
    $or: [
      { _id: { $in: assignmentChildIds } },
      { daycare: classroom.daycareId, classroom: classroom._id }
    ]
  };
  const [totalChildren, allChildren, children] = await Promise.all([
    Child.countDocuments(childFilter),
    Child.find(childFilter).select('dateOfBirth'),
    Child.find(childFilter).sort({ fullName: 1 }).skip(pagination.skip).limit(pagination.limit)
  ]);
  const childIds = allChildren.map((child) => child._id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentObservationsLast7Days = await Observation.countDocuments({
    status: 'active',
    occurredAt: { $gte: sevenDaysAgo },
    $or: [
      { classroomId: classroom._id },
      { daycareId: classroom.daycareId, childId: { $in: childIds } }
    ]
  });

  return {
    ...classroom.toObject(),
    daycare: {
      _id: daycare?._id ?? classroom.daycareId,
      id: (daycare?._id ?? classroom.daycareId).toString(),
      name: daycare?.name ?? null
    },
    analytics: {
      totalChildren,
      recentObservationsLast7Days,
      capacity: classroom.capacity ?? null
    },
    childrenPagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: totalChildren,
      totalPages: Math.ceil(totalChildren / pagination.limit)
    },
    children: children.map(classroomChildResponse)
  };
};

const assignChildrenToClassroom = async (input: {
  classroom: InstanceType<typeof Classroom>;
  childIds: string[];
  userId: unknown;
}) => {
  const assignments = await DaycareChildAssignment.find({
    daycareId: input.classroom.daycareId,
    childId: { $in: input.childIds },
    status: { $in: ['pending', 'active'] }
  });

  const assignedChildIds = new Set(assignments.map((assignment) => assignment.childId.toString()));
  const missingChildIds = input.childIds.filter((childId) => !assignedChildIds.has(childId));
  if (missingChildIds.length) {
    throw new AppError('Children must be assigned to this daycare before classroom placement', 403, missingChildIds);
  }

  await DaycareChildAssignment.updateMany(
    { daycareId: input.classroom.daycareId, childId: { $in: input.childIds }, status: { $in: ['pending', 'active'] } },
    { $set: { classroomId: input.classroom._id, status: 'active', acceptedBy: input.userId, acceptedAt: new Date() } }
  );
  await Invitation.updateMany(
    { type: 'daycare_child_assignment', daycareId: input.classroom.daycareId, childId: { $in: input.childIds }, status: 'pending' },
    { $set: { status: 'accepted', acceptedBy: input.userId, acceptedAt: new Date() } }
  );
  await Child.updateMany(
    { _id: { $in: input.childIds }, status: { $ne: 'deleted' } },
    { $set: { daycare: input.classroom.daycareId, classroom: input.classroom._id } }
  );

  return {
    daycareId: input.classroom.daycareId,
    classroomId: input.classroom._id,
    childIds: input.childIds,
    assignedCount: input.childIds.length
  };
};

classroomsRouter.post('/classroom', validate(classroomSchema), asyncHandler(async (req, res) => {
  const daycare = await getOwnedDaycareForApprovedUser(req.user);
  const classroom = await Classroom.create({ ...req.body, daycareId: daycare._id });
  ok(res, 'Classroom created', classroom, 201);
}));

classroomsRouter.get('/classroom', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const daycare = await getOwnedDaycareForApprovedUser(req.user);
  const filter = { daycareId: daycare._id, status: 'active' };
  const [total, classrooms] = await Promise.all([
    Classroom.countDocuments(filter),
    Classroom.find(filter).skip(skip).limit(limit)
  ]);
  paginated(res, 'Classrooms', classrooms, page, limit, total);
}));

classroomsRouter.post('/daycares/:daycareId/classrooms', requireDaycareAdmin(), validate(classroomSchema), asyncHandler(async (req, res) => {
  const classroom = await Classroom.create({ ...req.body, daycareId: req.params.daycareId });
  ok(res, 'Classroom created', classroom, 201);
}));

classroomsRouter.get('/daycares/:daycareId/classrooms', requireDaycareAccess(), asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { daycareId: req.params.daycareId, status: 'active' };
  const [total, classrooms] = await Promise.all([
    Classroom.countDocuments(filter),
    Classroom.find(filter).skip(skip).limit(limit)
  ]);
  paginated(res, 'Classrooms', classrooms, page, limit, total);
}));

classroomsRouter.get('/classrooms/:classroomId', asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.classroomId);
  if (!classroom) throw new AppError('Classroom not found', 404);
  if (req.user!.status !== 'active') throw new AppError('Account approval required', 403);
  const member = await import('../../services/AuthorizationService').then((m) =>
    m.AuthorizationService.canAccessDaycare(req.user!._id.toString(), classroom.daycareId.toString())
  );
  if (!member) throw new AppError('You do not have access to this daycare', 403);
  ok(res, 'Classroom', await classroomDetailsResponse(classroom, paginationFromQuery(req.query)));
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

classroomsRouter.post('/classrooms/:classroomId/children', validate(classroomChildrenSchema), asyncHandler(async (req, res) => {
  const classroom = await Classroom.findById(req.params.classroomId);
  if (!classroom) throw new AppError('Classroom not found', 404);
  const member = await import('../../services/AuthorizationService').then((m) => m.AuthorizationService.canAccessDaycare(req.user!._id.toString(), classroom.daycareId.toString()));
  if (!member) throw new AppError('You do not have access to this daycare', 403);
  const data = await assignChildrenToClassroom({
    classroom,
    childIds: childIdsFromBody(req.body),
    userId: req.user!._id
  });
  ok(res, 'Children assigned to classroom', data);
}));

classroomsRouter.post('/classroom/:classroomId/children', validate(classroomChildrenSchema), asyncHandler(async (req, res) => {
  const daycare = await getOwnedDaycareForApprovedUser(req.user);
  const classroom = await Classroom.findOne({ _id: req.params.classroomId, daycareId: daycare._id, status: 'active' });
  if (!classroom) throw new AppError('Classroom not found for this daycare', 404);

  const data = await assignChildrenToClassroom({
    classroom,
    childIds: childIdsFromBody(req.body),
    userId: req.user!._id
  });

  ok(res, 'Children assigned to classroom', data);
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
