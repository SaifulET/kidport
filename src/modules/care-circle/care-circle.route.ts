import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess, requireChildOwner } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { ok } from '../../utils/apiResponse';
import { randomToken, hashToken } from '../../utils/crypto';
import { EmailService } from '../../services/EmailService';
import { InvitationWorkflowService } from '../../services/ObservationService';
import { User } from '../users/user.model';
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
  validate(z.object({ body: z.object({ email: z.string().min(1), role: z.string(), relationship: z.string(), message: z.string().optional() }) })),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase().trim();
    if (!z.string().email().safeParse(email).success) throw new AppError('Invalid email', 400);
    if (email === req.user!.email) throw new AppError('You cannot invite your own email', 400);

    const invitedUser = await User.findOne({ email, status: 'active' });
    if (invitedUser) {
      const existingMember = await CareCircleMembership.findOne({ childId: req.params.childId, userId: invitedUser._id, status: 'active' });
      if (existingMember) throw new AppError('This caregiver is already in the care circle', 409);
    }

    const pendingInvitation = await Invitation.findOne({
      type: 'care_circle',
      childId: req.params.childId,
      email,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    });
    if (pendingInvitation) throw new AppError('A pending invitation already exists for this email', 409);

    const token = randomToken();
    const invitation = await Invitation.create({
      type: 'care_circle',
      tokenHash: hashToken(token),
      email,
      childId: req.params.childId,
      invitedBy: req.user!._id,
      role: req.body.role,
      relationship: req.body.relationship,
      message: req.body.message,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    void EmailService.careCircleInvite(email, token, req.body.message).catch((error) => {
      console.error('Failed to send care circle invitation email', error);
    });
    ok(res, 'Care circle invitation queued', { invitationId: invitation._id, emailStatus: 'queued' }, 201);
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

const acceptCareCircleInvitation = asyncHandler(async (req, res) => {
  const invitation = await InvitationWorkflowService.acceptCareCircleInvitation(hashToken(req.params.token), req.user!._id.toString());
  ok(res, 'Care circle invitation accepted', invitation);
});

careCircleRouter.get('/care-circle/invitations/:token/accept', requireAuth, acceptCareCircleInvitation);
careCircleRouter.post('/care-circle/invitations/:token/accept', requireAuth, acceptCareCircleInvitation);
