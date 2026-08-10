import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess, requireChildOwner } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { randomToken, hashToken } from '../../utils/crypto';
import { EmailService } from '../../services/EmailService';
import { InvitationWorkflowService } from '../../services/ObservationService';
import { CareCircleMembership } from './care-circle-membership.model';
import { Invitation } from './invitation.model';

export const careCircleRouter = Router();

careCircleRouter.get('/children/:childId/care-circle', requireAuth, requireChildAccess(), asyncHandler(async (req, res) => {
  const members = await CareCircleMembership.find({ childId: req.params.childId, status: 'active' }).populate('userId', 'fullName email profilePhoto caregiverRole daycareRole');
  ok(res, 'Care circle', members);
}));

careCircleRouter.post(
  '/children/:childId/care-circle/invite',
  requireAuth,
  requireChildOwner(),
  validate(z.object({ body: z.object({ email: z.string().email(), role: z.string(), relationship: z.string(), message: z.string().optional() }) })),
  asyncHandler(async (req, res) => {
    const token = randomToken();
    const invitation = await Invitation.create({
      type: 'care_circle',
      tokenHash: hashToken(token),
      email: req.body.email,
      childId: req.params.childId,
      invitedBy: req.user!._id,
      role: req.body.role,
      relationship: req.body.relationship,
      message: req.body.message,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    await EmailService.careCircleInvite(req.body.email, token, req.body.message);
    ok(res, 'Care circle invitation sent', { invitationId: invitation._id }, 201);
  })
);

careCircleRouter.patch('/children/:childId/care-circle/:memberId', requireAuth, requireChildOwner(), asyncHandler(async (req, res) => {
  const member = await CareCircleMembership.findOneAndUpdate({ _id: req.params.memberId, childId: req.params.childId }, { $set: req.body }, { new: true });
  ok(res, 'Care circle member updated', member);
}));

careCircleRouter.delete('/children/:childId/care-circle/:memberId', requireAuth, requireChildOwner(), asyncHandler(async (req, res) => {
  await CareCircleMembership.updateOne({ _id: req.params.memberId, childId: req.params.childId }, { $set: { status: 'removed' } });
  ok(res, 'Care circle member removed');
}));

careCircleRouter.post('/care-circle/invitations/:token/accept', requireAuth, asyncHandler(async (req, res) => {
  const invitation = await InvitationWorkflowService.acceptCareCircleInvitation(hashToken(req.params.token), req.user!._id.toString());
  ok(res, 'Care circle invitation accepted', invitation);
}));
