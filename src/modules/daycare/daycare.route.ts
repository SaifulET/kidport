import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireDaycareAccess, requireDaycareAdmin } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { hashToken } from '../../utils/crypto';
import { InvitationWorkflowService } from '../../services/ObservationService';
import { Daycare } from './daycare.model';
import { DaycareMember } from './daycare-member.model';
import { DaycareChildAssignment } from './daycare-child-assignment.model';

export const daycareRouter = Router();
daycareRouter.use(requireAuth);

daycareRouter.post(
  '/daycares',
  validate(z.object({ body: z.object({ name: z.string().min(1), description: z.string().optional(), address: z.string().optional(), phoneNumber: z.string().optional(), email: z.string().email().optional() }) })),
  asyncHandler(async (req, res) => {
    const daycare = await Daycare.create({ ...req.body, ownerId: req.user!._id });
    await DaycareMember.create({ daycareId: daycare._id, userId: req.user!._id, role: 'daycare_admin' });
    ok(res, 'Daycare created', daycare, 201);
  })
);

daycareRouter.get('/daycares/:daycareId', requireDaycareAccess(), asyncHandler(async (req, res) => ok(res, 'Daycare', await Daycare.findById(req.params.daycareId))));
daycareRouter.patch('/daycares/:daycareId', requireDaycareAdmin(), asyncHandler(async (req, res) => ok(res, 'Daycare updated', await Daycare.findByIdAndUpdate(req.params.daycareId, { $set: req.body }, { new: true }))));

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

daycareRouter.post('/daycare-invitations/:token/accept', asyncHandler(async (req, res) => {
  const assignment = await InvitationWorkflowService.acceptDaycareAssignment(hashToken(req.params.token), req.user!._id.toString());
  ok(res, 'Daycare assignment accepted', assignment);
}));

daycareRouter.get('/daycares/:daycareId/children/unassigned', requireDaycareAccess(), asyncHandler(async (req, res) => {
  const assignments = await DaycareChildAssignment.find({ daycareId: req.params.daycareId, status: 'active', classroomId: { $exists: false } }).populate('childId');
  ok(res, 'Unassigned daycare children', assignments);
}));
