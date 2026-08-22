import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireDaycareAccess, requireDaycareAdmin } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { ok } from '../../utils/apiResponse';
import { hashToken } from '../../utils/crypto';
import { InvitationWorkflowService } from '../../services/ObservationService';
import { DaycareAccountService } from '../../services/DaycareAccountService';
import { Daycare } from './daycare.model';
import { DaycareMember } from './daycare-member.model';
import { DaycareChildAssignment } from './daycare-child-assignment.model';
import { Classroom } from '../classrooms/classroom.model';
import { Observation } from '../observations/observation.model';
import { User } from '../users/user.model';
import { Invitation } from '../care-circle/invitation.model';

export const daycareRouter = Router();
daycareRouter.use(requireAuth);

const memberRoleSchema = z.enum(['daycare_admin', 'daycare_employee']);
const memberStatusSchema = z.enum(['pending', 'active', 'removed', 'rejected']);
const memberClassroomIdsSchema = z.array(z.string()).optional();
const unassignedClassroomFilter = { $or: [{ classroomId: { $exists: false } }, { classroomId: null }] };

const childIdString = (record: { childId?: unknown }) => {
  const childId = record.childId as { _id?: unknown; toString?: () => string } | undefined;
  const raw = childId && typeof childId === 'object' && '_id' in childId ? childId._id : childId;
  return raw?.toString?.();
};

const approvedDaycareIds = async () => {
  const activeOwnerIds = await User.find({ userType: 'daycare', status: 'active' }).distinct('_id');
  return DaycareMember.find({
    userId: { $in: activeOwnerIds },
    role: 'daycare_admin',
    status: 'active'
  }).distinct('daycareId');
};

const unassignedChildrenForDaycare = async (daycareId: unknown) => {
  const [assignments, invitations] = await Promise.all([
    DaycareChildAssignment.find({
      daycareId,
      status: { $in: ['pending', 'active'] },
      ...unassignedClassroomFilter
    }).populate('childId').lean(),
    Invitation.find({
      type: 'daycare_child_assignment',
      daycareId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('childId').lean()
  ]);

  const assignmentChildIds = new Set(assignments.map(childIdString).filter(Boolean));
  const invitationChildren = invitations
    .filter((invitation) => {
      const invitedChildId = childIdString(invitation);
      return invitedChildId && !assignmentChildIds.has(invitedChildId);
    })
    .map((invitation) => ({
      _id: invitation._id,
      invitationId: invitation._id,
      childId: invitation.childId,
      daycareId: invitation.daycareId,
      status: 'pending',
      source: 'invitation',
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt
    }));

  return [...assignments, ...invitationChildren];
};

const requireDaycareAccount = asyncHandler(async (req, _res, next) => {
  if (req.user!.userType !== 'daycare') throw new AppError('Only daycare accounts can manage daycare information', 403);
  if (req.user!.status !== 'active') throw new AppError('Account approval required', 403);
  next();
});

const requireDaycareOwner = asyncHandler(async (req, _res, next) => {
  if (req.user!.userType !== 'daycare') throw new AppError('Only daycare accounts can manage daycare information', 403);
  if (req.user!.status !== 'active') throw new AppError('Account approval required', 403);
  const daycare = await Daycare.findOne({ _id: req.params.daycareId, status: { $ne: 'deleted' } });
  if (!daycare) throw new AppError('Daycare not found', 404);
  if (daycare.ownerId.toString() !== req.user!._id.toString()) throw new AppError('Only the daycare owner can manage this daycare', 403);
  next();
});

daycareRouter.get('/daycares', asyncHandler(async (_req, res) => {
  const daycares = await Daycare.find({ _id: { $in: await approvedDaycareIds() }, status: 'active' }).sort({ name: 1 });
  ok(res, 'Daycares', daycares);
}));

daycareRouter.get('/daycare', requireDaycareAccount, asyncHandler(async (req, res) => {
  const daycare = await DaycareAccountService.getApprovedOwnerDaycare(req.user!);
  ok(res, 'Daycare', daycare);
}));

daycareRouter.get('/daycare/stats', requireDaycareAccount, asyncHandler(async (req, res) => {
  const daycare = await DaycareAccountService.getApprovedOwnerDaycare(req.user!);
  const [totalClassrooms, totalObservations, associatedChildIds] = await Promise.all([
    Classroom.countDocuments({ daycareId: daycare._id, status: 'active' }),
    Observation.countDocuments({ daycareId: daycare._id, status: 'active' }),
    DaycareChildAssignment.find({ daycareId: daycare._id, status: 'active' }).distinct('childId')
  ]);

  ok(res, 'Daycare stats', {
    daycareId: daycare._id,
    totalClassrooms,
    totalObservations,
    totalAssociatedChildren: associatedChildIds.length
  });
}));

daycareRouter.post(
  '/daycares',
  requireDaycareAccount,
  validate(z.object({ body: z.object({ name: z.string().min(1), description: z.string().optional(), address: z.string().optional(), phoneNumber: z.string().optional(), email: z.string().email().optional() }) })),
  asyncHandler(async (req, res) => {
    const daycare = await Daycare.create({ ...req.body, ownerId: req.user!._id });
    await DaycareMember.create({ daycareId: daycare._id, userId: req.user!._id, role: 'daycare_admin' });
    ok(res, 'Daycare created', daycare, 201);
  })
);

daycareRouter.get('/daycares/:daycareId', asyncHandler(async (req, res) => {
  const daycare = await Daycare.findOne({ _id: { $eq: req.params.daycareId, $in: await approvedDaycareIds() }, status: 'active' });
  if (!daycare) throw new AppError('Daycare not found', 404);
  ok(res, 'Daycare', daycare);
}));

daycareRouter.patch(
  '/daycares/:daycareId',
  requireDaycareOwner,
  asyncHandler(async (req, res) => ok(res, 'Daycare updated', await Daycare.findByIdAndUpdate(req.params.daycareId, { $set: req.body }, { new: true })))
);

daycareRouter.delete('/daycares/:daycareId', requireDaycareOwner, asyncHandler(async (req, res) => {
  await Daycare.updateOne({ _id: req.params.daycareId }, { $set: { status: 'deleted' } });
  await DaycareMember.updateMany({ daycareId: req.params.daycareId }, { $set: { status: 'removed' } });
  ok(res, 'Daycare deleted');
}));

daycareRouter.post(
  '/daycares/:daycareId/members',
  requireDaycareAdmin(),
  validate(z.object({ body: z.object({ userId: z.string(), role: memberRoleSchema, classroomIds: memberClassroomIdsSchema }) })),
  asyncHandler(async (req, res) => {
    const member = await DaycareMember.findOneAndUpdate(
      { daycareId: req.params.daycareId, userId: req.body.userId },
      { $set: { role: req.body.role, classroomIds: req.body.classroomIds ?? [], status: 'active' } },
      { upsert: true, new: true }
    );
    ok(res, 'Daycare member saved', member, 201);
  })
);

daycareRouter.post(
  '/daycares/:daycareId/member-requests',
  validate(z.object({ body: z.object({ classroomIds: memberClassroomIdsSchema }).optional() })),
  asyncHandler(async (req, res) => {
    const daycare = await Daycare.findOne({ _id: req.params.daycareId, status: 'active' });
    if (!daycare) throw new AppError('Daycare not found', 404);

    const existing = await DaycareMember.findOne({ daycareId: req.params.daycareId, userId: req.user!._id });
    if (existing?.status === 'active') throw new AppError('You are already an active daycare member', 409);

    const member = await DaycareMember.findOneAndUpdate(
      { daycareId: req.params.daycareId, userId: req.user!._id },
      {
        $set: {
          role: 'daycare_employee',
          classroomIds: req.body?.classroomIds ?? [],
          status: 'pending'
        }
      },
      { upsert: true, new: true }
    );

    ok(res, 'Daycare member request submitted', member, 201);
  })
);

daycareRouter.get(
  '/daycares/:daycareId/members',
  requireDaycareAdmin(),
  validate(z.object({ query: z.object({ status: memberStatusSchema.default('active') }) })),
  asyncHandler(async (req, res) => {
    ok(
      res,
      'Daycare members',
      await DaycareMember.find({ daycareId: req.params.daycareId, status: req.query.status }).populate('userId', 'fullName email daycareRole')
    );
  })
);

daycareRouter.post(
  '/daycares/:daycareId/members/:memberId/approve',
  requireDaycareAdmin(),
  validate(z.object({ body: z.object({ role: memberRoleSchema.optional(), classroomIds: memberClassroomIdsSchema }).optional() })),
  asyncHandler(async (req, res) => {
    const member = await DaycareMember.findOneAndUpdate(
      { _id: req.params.memberId, daycareId: req.params.daycareId, status: 'pending' },
      {
        $set: {
          ...(req.body?.role ? { role: req.body.role } : {}),
          ...(req.body?.classroomIds ? { classroomIds: req.body.classroomIds } : {}),
          status: 'active'
        }
      },
      { new: true }
    );
    if (!member) throw new AppError('Pending daycare member request not found', 404);
    ok(res, 'Daycare member approved', member);
  })
);

daycareRouter.post('/daycares/:daycareId/members/:memberId/reject', requireDaycareAdmin(), asyncHandler(async (req, res) => {
  const member = await DaycareMember.findOneAndUpdate(
    { _id: req.params.memberId, daycareId: req.params.daycareId, status: 'pending' },
    { $set: { status: 'rejected' } },
    { new: true }
  );
  if (!member) throw new AppError('Pending daycare member request not found', 404);
  ok(res, 'Daycare member request rejected', member);
}));

daycareRouter.get(
  '/daycare/members',
  requireDaycareAccount,
  validate(z.object({ query: z.object({ status: memberStatusSchema.default('active') }) })),
  asyncHandler(async (req, res) => {
    const daycare = await DaycareAccountService.getApprovedOwnerDaycare(req.user!);
    ok(
      res,
      'Daycare members',
      await DaycareMember.find({ daycareId: daycare._id, status: req.query.status }).populate('userId', 'fullName email daycareRole')
    );
  })
);

daycareRouter.post(
  '/daycare/members',
  requireDaycareAccount,
  validate(z.object({ body: z.object({ userId: z.string(), role: memberRoleSchema, classroomIds: memberClassroomIdsSchema }) })),
  asyncHandler(async (req, res) => {
    const daycare = await DaycareAccountService.getApprovedOwnerDaycare(req.user!);
    const member = await DaycareMember.findOneAndUpdate(
      { daycareId: daycare._id, userId: req.body.userId },
      { $set: { role: req.body.role, classroomIds: req.body.classroomIds ?? [], status: 'active' } },
      { upsert: true, new: true }
    );
    ok(res, 'Daycare member saved', member, 201);
  })
);

daycareRouter.post(
  '/daycare/members/:memberId/approve',
  requireDaycareAccount,
  validate(z.object({ body: z.object({ role: memberRoleSchema.optional(), classroomIds: memberClassroomIdsSchema }).optional() })),
  asyncHandler(async (req, res) => {
    const daycare = await DaycareAccountService.getApprovedOwnerDaycare(req.user!);
    const member = await DaycareMember.findOneAndUpdate(
      { _id: req.params.memberId, daycareId: daycare._id, status: 'pending' },
      {
        $set: {
          ...(req.body?.role ? { role: req.body.role } : {}),
          ...(req.body?.classroomIds ? { classroomIds: req.body.classroomIds } : {}),
          status: 'active'
        }
      },
      { new: true }
    );
    if (!member) throw new AppError('Pending daycare member request not found', 404);
    ok(res, 'Daycare member approved', member);
  })
);

daycareRouter.post('/daycare/members/:memberId/reject', requireDaycareAccount, asyncHandler(async (req, res) => {
  const daycare = await DaycareAccountService.getApprovedOwnerDaycare(req.user!);
  const member = await DaycareMember.findOneAndUpdate(
    { _id: req.params.memberId, daycareId: daycare._id, status: 'pending' },
    { $set: { status: 'rejected' } },
    { new: true }
  );
  if (!member) throw new AppError('Pending daycare member request not found', 404);
  ok(res, 'Daycare member request rejected', member);
}));

daycareRouter.patch('/daycares/:daycareId/members/:memberId', requireDaycareAdmin(), asyncHandler(async (req, res) => {
  const member = await DaycareMember.findOneAndUpdate({ _id: req.params.memberId, daycareId: req.params.daycareId }, { $set: req.body }, { new: true });
  ok(res, 'Daycare member updated', member);
}));

daycareRouter.delete('/daycares/:daycareId/members/:memberId', requireDaycareAdmin(), asyncHandler(async (req, res) => {
  await DaycareMember.updateOne({ _id: req.params.memberId, daycareId: req.params.daycareId }, { $set: { status: 'removed' } });
  ok(res, 'Daycare member removed');
}));

daycareRouter.get('/daycare-invitations/:token', asyncHandler(async (req, res) => {
  ok(res, 'Daycare invitation', { token: req.params.token });
}));

const acceptDaycareInvitation = asyncHandler(async (req, res) => {
  const assignment = await InvitationWorkflowService.acceptDaycareAssignment(hashToken(req.params.token), req.user!._id.toString());
  ok(res, 'Daycare assignment accepted', assignment);
});

daycareRouter.get('/daycare-invitations/:token/accept', acceptDaycareInvitation);
daycareRouter.post('/daycare-invitations/:token/accept', acceptDaycareInvitation);

daycareRouter.get('/daycares/:daycareId/children/unassigned', requireDaycareAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Unassigned daycare children', await unassignedChildrenForDaycare(req.params.daycareId));
}));

daycareRouter.get('/daycare/children/unassigned', requireDaycareAccount, asyncHandler(async (req, res) => {
  const daycare = await DaycareAccountService.getApprovedOwnerDaycare(req.user!);
  ok(res, 'Unassigned daycare children', await unassignedChildrenForDaycare(daycare._id));
}));
