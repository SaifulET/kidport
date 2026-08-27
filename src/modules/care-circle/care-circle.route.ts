import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess, requireChildOwner } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { ok, paginated } from '../../utils/apiResponse';
import { paginateArray, paginationFromQuery } from '../../utils/pagination';
import { randomToken, hashToken } from '../../utils/crypto';
import { EmailService } from '../../services/EmailService';
import { InvitationWorkflowService } from '../../services/ObservationService';
import { NotificationService } from '../../services/NotificationService';
import { User } from '../users/user.model';
import { Child } from '../children/child.model';
import { Daycare } from '../daycare/daycare.model';
import { DaycareChildAssignment } from '../daycare/daycare-child-assignment.model';
import { DaycareMember } from '../daycare/daycare-member.model';
import { CareCircleMembership } from './care-circle-membership.model';
import { Invitation } from './invitation.model';

export const careCircleRouter = Router();

const userFields = 'fullName email profilePhoto caregiverRole daycareRole userType';

const defaultPermissions = (canManage = false) => ({
  canView: true,
  canComment: true,
  canObserve: true,
  canInvite: canManage,
  canManage
});

const userIdString = (value: unknown) => {
  const user = value as { _id?: unknown; toString?: () => string } | undefined;
  const raw = user && typeof user === 'object' && '_id' in user ? user._id : user;
  return raw?.toString?.();
};

const serializeUser = (user: unknown) => {
  if (!user || typeof user !== 'object') return null;
  const data = user as Record<string, any>;
  return {
    _id: data._id?.toString?.() ?? data.id?.toString?.() ?? null,
    fullName: data.fullName ?? null,
    email: data.email ?? null,
    caregiverRole: data.caregiverRole ?? undefined,
    daycareRole: data.daycareRole ?? undefined,
    userType: data.userType ?? undefined,
    profilePhoto: typeof data.profilePhoto === 'string' ? data.profilePhoto : data.profilePhoto?.url ?? null
  };
};

const careCirclePayload = async (childId: string) => {
  const [child, memberships, assignments] = await Promise.all([
    Child.findById(childId).select('createdBy caregivers daycare').lean(),
    CareCircleMembership.find({ childId, status: 'active' }).populate('userId', userFields).lean(),
    DaycareChildAssignment.find({ childId, status: 'active' }).select('daycareId classroomId acceptedAt createdAt updatedAt').lean()
  ]);
  if (!child) throw new AppError('Child not found', 404);

  const byKey = new Map<string, Record<string, unknown>>();
  const addEntry = (key: string, entry: Record<string, unknown>) => {
    if (!byKey.has(key)) byKey.set(key, entry);
  };

  for (const membership of memberships) {
    const id = userIdString(membership.userId);
    if (!id) continue;
    addEntry(`user:${id}`, {
      ...membership,
      _id: membership._id?.toString?.(),
      childId,
      userId: serializeUser(membership.userId),
      source: 'care_circle'
    });
  }

  const childUserIds = [...new Set([
    child.createdBy?.toString?.(),
    ...(child.caregivers ?? []).map((id: unknown) => id?.toString?.())
  ].filter(Boolean))] as string[];
  const missingChildUserIds = childUserIds.filter((id) => !byKey.has(`user:${id}`));
  if (missingChildUserIds.length) {
    const users = await User.find({ _id: { $in: missingChildUserIds }, status: { $ne: 'deleted' } }).select(userFields).lean();
    for (const user of users) {
      const id = user._id.toString();
      const isOwner = child.createdBy?.toString?.() === id;
      addEntry(`user:${id}`, {
        _id: `child-user:${childId}:${id}`,
        childId,
        userId: serializeUser(user),
        role: user.caregiverRole ?? 'parent',
        relationship: user.caregiverRole ?? 'parent',
        permissions: defaultPermissions(isOwner),
        status: 'active',
        source: isOwner ? 'child_owner' : 'child_caregiver'
      });
    }
  }

  const daycareIds = [...new Set([
    child.daycare?.toString?.(),
    ...assignments.map((assignment) => assignment.daycareId?.toString?.())
  ].filter(Boolean))] as string[];
  if (daycareIds.length) {
    const [daycares, daycareMembers] = await Promise.all([
      Daycare.find({ _id: { $in: daycareIds }, status: { $ne: 'deleted' } }).select('name email phoneNumber ownerId status').lean(),
      DaycareMember.find({ daycareId: { $in: daycareIds }, status: 'active' }).populate('userId', userFields).lean()
    ]);
    const daycareById = new Map(daycares.map((daycare) => [daycare._id.toString(), daycare]));
    const memberDaycareUserKeys = new Set<string>();

    for (const member of daycareMembers) {
      const daycareId = member.daycareId.toString();
      const daycare = daycareById.get(daycareId);
      const id = userIdString(member.userId);
      if (!daycare || !id) continue;
      memberDaycareUserKeys.add(`${daycareId}:${id}`);
      addEntry(`daycare:${daycareId}:user:${id}`, {
        _id: `daycare-member:${daycareId}:${id}`,
        childId,
        userId: serializeUser(member.userId),
        role: member.role,
        relationship: 'daycare',
        permissions: defaultPermissions(member.role === 'daycare_admin'),
        status: 'active',
        daycare: {
          _id: daycare._id.toString(),
          name: daycare.name,
          email: daycare.email ?? null,
          phoneNumber: daycare.phoneNumber ?? null
        },
        source: 'daycare'
      });
    }

    const ownerIds = daycares
      .filter((daycare) => !memberDaycareUserKeys.has(`${daycare._id.toString()}:${daycare.ownerId.toString()}`))
      .map((daycare) => daycare.ownerId.toString());
    const owners = ownerIds.length
      ? await User.find({ _id: { $in: ownerIds }, status: { $ne: 'deleted' } }).select(userFields).lean()
      : [];
    const ownerById = new Map(owners.map((owner) => [owner._id.toString(), owner]));

    for (const daycare of daycares) {
      const owner = ownerById.get(daycare.ownerId.toString());
      if (!owner) continue;
      const daycareId = daycare._id.toString();
      const id = owner._id.toString();
      addEntry(`daycare:${daycareId}:user:${id}`, {
        _id: `daycare-owner:${daycareId}:${id}`,
        childId,
        userId: serializeUser(owner),
        role: 'daycare_admin',
        relationship: 'daycare',
        permissions: defaultPermissions(true),
        status: 'active',
        daycare: {
          _id: daycareId,
          name: daycare.name,
          email: daycare.email ?? null,
          phoneNumber: daycare.phoneNumber ?? null
        },
        source: 'daycare'
      });
    }
  }

  return Array.from(byKey.values());
};

careCircleRouter.get('/children/:childId/care-circle', requireAuth, requireChildAccess(), asyncHandler(async (req, res) => {
  const { page, limit } = paginationFromQuery(req.query);
  const members = await careCirclePayload(req.params.childId);
  paginated(res, 'Care circle', paginateArray(members, page, limit), page, limit, members.length);
}));

careCircleRouter.post(
  '/children/:childId/care-circle/invite',
  requireAuth,
  requireChildOwner(),
  validate(z.object({ body: z.object({ email: z.string().min(1), role: z.string(), message: z.string().optional() }) })),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase().trim();
    if (!z.string().email().safeParse(email).success) throw new AppError('Invalid email', 400);
    if (email === req.user!.email) throw new AppError('You cannot invite your own email', 400);
    if (['daycare', 'daycare_admin', 'daycare_employee'].includes(req.body.role)) {
      throw new AppError('Use daycare invitation API for daycare invitations', 400);
    }
    const child = await Child.findById(req.params.childId);
    if (!child) throw new AppError('Child not found', 404);

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
      message: req.body.message,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    void EmailService.careCircleInvite(email, token, child.fullName, req.body.role, req.body.message).catch((error) => {
      console.error('Failed to send care circle invitation email', error);
    });
    void NotificationService.createChildInvitationNotifications({
      childId: req.params.childId,
      invitationId: invitation._id.toString(),
      actorId: req.user!._id.toString(),
      actorName: req.user!.fullName,
      childName: child.fullName,
      invitedEmail: email,
      invitationType: 'care_circle',
      role: req.body.role
    }).catch((error) => console.error('Failed to create care circle invitation notifications', error));
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
