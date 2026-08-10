import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess, requireChildOwner } from '../../middlewares/authorization';
import { upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, paginated } from '../../utils/apiResponse';
import { calculateAge } from '../../utils/date';
import { randomToken, hashToken } from '../../utils/crypto';
import { AccessibleChildrenService } from '../../services/AccessibleChildrenService';
import { DevelopmentScoringService } from '../../services/DevelopmentScoringService';
import { ReportService } from '../../services/ReportService';
import { EmailService } from '../../services/EmailService';
import { Child } from './child.model';
import { CareCircleMembership } from '../care-circle/care-circle-membership.model';
import { Daycare } from '../daycare/daycare.model';
import { DaycareChildAssignment } from '../daycare/daycare-child-assignment.model';
import { Invitation } from '../care-circle/invitation.model';
import { Observation } from '../observations/observation.model';

export const childrenRouter = Router();
childrenRouter.use(requireAuth);

const childSchema = z.object({
  body: z.object({
    fullName: z.string().min(1),
    nickname: z.string().optional(),
    dateOfBirth: z.coerce.date(),
    gender: z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say', 'other']).optional(),
    bloodType: z.string().optional(),
    height: z.object({ value: z.number(), unit: z.string(), measuredAt: z.coerce.date().optional() }).optional(),
    weight: z.object({ value: z.number(), unit: z.string(), measuredAt: z.coerce.date().optional() }).optional()
  })
});

childrenRouter.post(
  '/',
  validate(childSchema),
  asyncHandler(async (req, res) => {
    const child = await Child.create({ ...req.body, createdBy: req.user!._id, caregivers: [req.user!._id] });
    await CareCircleMembership.create({
      childId: child._id,
      userId: req.user!._id,
      role: req.user!.caregiverRole ?? 'parent',
      relationship: req.user!.caregiverRole ?? 'parent',
      permissions: { canView: true, canComment: true, canObserve: true, canInvite: true, canManage: true }
    });
    ok(res, 'Child created', { ...child.toObject(), age: calculateAge(child.dateOfBirth) }, 201);
  })
);

childrenRouter.get(
  '/selector',
  asyncHandler(async (req, res) => {
    const ids = await AccessibleChildrenService.idsForUser(req.user!._id.toString());
    const children = await Child.find({ _id: { $in: ids }, status: { $ne: 'deleted' } }).select('fullName nickname profilePhoto dateOfBirth');
    ok(
      res,
      'Child selector',
      children.map((child) => ({
        id: child._id,
        profileImage: child.profilePhoto,
        name: child.nickname ?? child.fullName,
        age: calculateAge(child.dateOfBirth),
        developmentalAge: null,
        active: req.user!.activeChildId?.toString() === child._id.toString()
      }))
    );
  })
);

childrenRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const ids = await AccessibleChildrenService.idsForUser(req.user!._id.toString());
    const children = await Child.find({ _id: { $in: ids }, status: { $ne: 'deleted' } }).sort({ createdAt: -1 });
    ok(res, 'Children', children.map((child) => ({ ...child.toObject(), age: calculateAge(child.dateOfBirth) })));
  })
);

childrenRouter.get('/:childId', requireChildAccess(), asyncHandler(async (req, res) => {
  const child = await Child.findById(req.params.childId);
  ok(res, 'Child', child ? { ...child.toObject(), age: calculateAge(child.dateOfBirth) } : null);
}));

childrenRouter.patch(
  '/:childId',
  requireChildOwner(),
  asyncHandler(async (req, res) => {
    const child = await Child.findByIdAndUpdate(req.params.childId, { $set: req.body }, { new: true });
    ok(res, 'Child updated', child);
  })
);

childrenRouter.delete('/:childId', requireChildOwner(), asyncHandler(async (req, res) => {
  await Child.updateOne({ _id: req.params.childId }, { $set: { status: 'deleted', deletedAt: new Date() } });
  ok(res, 'Child deleted');
}));

childrenRouter.get('/:childId/development-progress', requireChildAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Development progress', await DevelopmentScoringService.calculateChildProgress(req.params.childId));
}));

childrenRouter.get('/:childId/dashboard', requireChildAccess(), asyncHandler(async (req, res) => {
  const child = await Child.findById(req.params.childId);
  const [progress, careCircle, recentActivities] = await Promise.all([
    DevelopmentScoringService.calculateChildProgress(req.params.childId),
    CareCircleMembership.find({ childId: req.params.childId, status: 'active' }).populate('userId', 'fullName profilePhoto caregiverRole daycareRole'),
    Observation.find({ childId: req.params.childId, status: 'active' }).sort({ createdAt: -1 }).limit(10)
  ]);
  ok(res, 'Dashboard', {
    child,
    todayInsight: { disclaimer: 'AI insights are guidance only, not a diagnosis.' },
    developmentProgress: progress.domains,
    pediatricReport: { overallScore: DevelopmentScoringService.calculateOverallScore(progress.domains) },
    careCircle,
    recentActivities
  });
}));

childrenRouter.get('/:childId/activities', requireChildAccess(), asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const total = await Observation.countDocuments({ childId: req.params.childId, status: 'active' });
  const activities = await Observation.find({ childId: req.params.childId, status: 'active' }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  paginated(res, 'Activities', activities, page, limit, total);
}));

childrenRouter.get('/:childId/activity-history', requireChildAccess(), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { childId: req.params.childId, status: 'active' };
  if (req.query.domain) filter.domainId = req.query.domain;
  ok(res, 'Activity history', await Observation.find(filter).sort({ occurredAt: -1 }));
}));

childrenRouter.get('/:childId/milestones', requireChildAccess(), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { childId: req.params.childId, isMilestone: true, status: 'active' };
  if (req.query.domain) filter.domainId = req.query.domain;
  const milestones = await Observation.find(filter).populate('domainId indicatorId authorId', 'name title fullName').sort({ occurredAt: -1 });
  ok(res, 'Milestones', milestones);
}));

childrenRouter.get('/:childId/achievements', requireChildAccess(), asyncHandler(async (req, res) => {
  const achievements = await Observation.find({ childId: req.params.childId, isMilestone: true, status: 'active' })
    .populate('domainId indicatorId authorId', 'name title fullName')
    .sort({ occurredAt: -1 });
  ok(res, 'Achievements', achievements);
}));

childrenRouter.get('/:childId/reports/development', requireChildAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Development report', await ReportService.developmentReport(req.params.childId));
}));

childrenRouter.get('/:childId/reports/development/pdf', requireChildAccess(), asyncHandler(async (req, res) => {
  const pdf = await ReportService.developmentReportPdf(req.params.childId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="development-report.pdf"');
  res.send(pdf);
}));

childrenRouter.post('/:childId/reports/:reportId/share', requireChildOwner(), asyncHandler(async (_req, res) => {
  ok(res, 'Report share link requested', { status: 'pending_email_delivery' });
}));

childrenRouter.get('/:childId/expert-guidance', requireChildAccess(), asyncHandler(async (req, res) => {
  const report = await ReportService.developmentReport(req.params.childId);
  ok(res, 'Expert guidance', {
    disclaimer: report.disclaimer,
    suggestions: report.ai.positiveHighlights,
    questionsToDiscuss: report.ai.flagsToDiscuss.map((flag: { title: string }) => flag.title)
  });
}));

childrenRouter.patch('/:childId/profile-photo', requireChildOwner(), upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new Error('Photo is required');
  const media = await import('../../services/StorageService').then((m) => m.StorageService.uploadBuffer(`children/${req.params.childId}/profile`, req.file!));
  const child = await Child.findByIdAndUpdate(req.params.childId, { $set: { profilePhoto: media } }, { new: true });
  ok(res, 'Child profile photo updated', child);
}));

childrenRouter.post(
  '/:childId/daycare-invitations',
  requireChildOwner(),
  validate(z.object({ body: z.object({ daycareId: z.string(), email: z.string().email().optional(), message: z.string().optional() }) })),
  asyncHandler(async (req, res) => {
    const daycare = await Daycare.findById(req.body.daycareId);
    const child = await Child.findById(req.params.childId);
    if (!daycare || !child) throw new Error('Daycare or child not found');
    const token = randomToken();
    const invitation = await Invitation.create({
      type: 'daycare_child_assignment',
      tokenHash: hashToken(token),
      email: req.body.email ?? daycare.email ?? 'unconfigured-daycare-email@kidport.local',
      childId: req.params.childId,
      daycareId: req.body.daycareId,
      invitedBy: req.user!._id,
      message: req.body.message,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    await DaycareChildAssignment.updateOne(
      { childId: req.params.childId, daycareId: req.body.daycareId },
      { $set: { assignedBy: req.user!._id, status: 'pending' } },
      { upsert: true }
    );
    if (invitation.email) await EmailService.daycareInvite(invitation.email, token, child.fullName);
    ok(res, 'Daycare invitation sent', { invitationId: invitation._id }, 201);
  })
);
