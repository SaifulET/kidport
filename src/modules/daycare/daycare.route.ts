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
import { Daycare } from './daycare.model';
import { DaycareMember } from './daycare-member.model';
import { DaycareChildAssignment } from './daycare-child-assignment.model';

export const daycareRouter = Router();
daycareRouter.use(requireAuth);

const requireDaycareAccount = asyncHandler(async (req, _res, next) => {
  if (req.user!.userType !== 'daycare') throw new AppError('Only daycare accounts can manage daycare information', 403);
  next();
});

const requireDaycareOwner = asyncHandler(async (req, _res, next) => {
  if (req.user!.userType !== 'daycare') throw new AppError('Only daycare accounts can manage daycare information', 403);
  const daycare = await Daycare.findOne({ _id: req.params.daycareId, status: { $ne: 'deleted' } });
  if (!daycare) throw new AppError('Daycare not found', 404);
  if (daycare.ownerId.toString() !== req.user!._id.toString()) throw new AppError('Only the daycare owner can manage this daycare', 403);
  next();
});

daycareRouter.get('/daycares', asyncHandler(async (_req, res) => {
  const daycares = await Daycare.find({ status: 'active' }).sort({ name: 1 });
  ok(res, 'Daycares', daycares);
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
  const daycare = await Daycare.findOne({ _id: req.params.daycareId, status: 'active' });
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
  validate(z.object({ body: z.object({ userId: z.string(), role: z.enum(['daycare_admin', 'daycare_employee']), classroomIds: z.array(z.string()).optional() }) })),
  asyncHandler(async (req, res) => {
    const member = await DaycareMember.findOneAndUpdate(
      { daycareId: req.params.daycareId, userId: req.body.userId },
      { $set: { role: req.body.role, classroomIds: req.body.classroomIds ?? [], status: 'active' } },
      { upsert: true, new: true }
    );
    ok(res, 'Daycare member saved', member, 201);
  })
);

daycareRouter.get('/daycares/:daycareId/members', requireDaycareAdmin(), asyncHandler(async (req, res) => {
  ok(res, 'Daycare members', await DaycareMember.find({ daycareId: req.params.daycareId, status: 'active' }).populate('userId', 'fullName email daycareRole'));
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
  const assignments = await DaycareChildAssignment.find({ daycareId: req.params.daycareId, status: 'active', classroomId: { $exists: false } }).populate('childId');
  ok(res, 'Unassigned daycare children', assignments);
}));
