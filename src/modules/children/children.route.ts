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
import { StorageService } from '../../services/StorageService';
import { SocialResponseService } from '../../services/SocialResponseService';
import { Child } from './child.model';
import { CareCircleMembership } from '../care-circle/care-circle-membership.model';
import { Daycare } from '../daycare/daycare.model';
import { DaycareChildAssignment } from '../daycare/daycare-child-assignment.model';
import { Invitation } from '../care-circle/invitation.model';
import { Observation } from '../observations/observation.model';

export const childrenRouter = Router();
childrenRouter.use(requireAuth);

const childResponse = (child: InstanceType<typeof Child>) => {
  const data = child.toObject();
  const { profilePhoto: _profilePhoto, ...rest } = data;
  return { ...rest, profileImage: child.profilePhoto?.url, age: calculateAge(child.dateOfBirth) };
};

const measurementSchema = z.union([
  z.coerce.number().positive(),
  z.object({ value: z.coerce.number().positive(), unit: z.string().optional(), measuredAt: z.coerce.date().optional() })
]);

const genderSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : value),
  z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say', 'other'])
);

const childSchema = z.object({
  body: z
    .object({
      fullName: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      nickname: z.string().optional(),
      dateOfBirth: z.coerce.date().optional(),
      dob: z.coerce.date().optional(),
      gender: genderSchema,
      bloodType: z.string().optional(),
      height: measurementSchema.optional(),
      weight: measurementSchema.optional()
    })
    .superRefine((body, ctx) => {
      if (!body.fullName && !body.name) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Name is required' });
      }
      if (!body.dateOfBirth && !body.dob) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dob'], message: 'Date of birth is required' });
      }
    })
});

const updateChildSchema = z.object({
  body: z.object({
    fullName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    nickname: z.string().optional(),
    dateOfBirth: z.coerce.date().optional(),
    dob: z.coerce.date().optional(),
    gender: genderSchema.optional(),
    bloodType: z.string().optional(),
    height: measurementSchema.optional(),
    weight: measurementSchema.optional()
  })
});

const measurement = (value: unknown, unit: string) => {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return { value, unit, measuredAt: new Date() };
  return value;
};

const childPayload = (body: Record<string, unknown>) => ({
  fullName: body.fullName ?? body.name,
  nickname: body.nickname,
  dateOfBirth: body.dateOfBirth ?? body.dob,
  gender: body.gender,
  bloodType: body.bloodType,
  height: measurement(body.height, 'in'),
  weight: measurement(body.weight, 'lbs')
});

childrenRouter.post(
  '/children',
  upload.single('photo'),
  validate(childSchema),
  asyncHandler(async (req, res) => {
    const child = new Child({
      ...childPayload(req.body),
      createdBy: req.user!._id,
      caregivers: [req.user!._id]
    });
    if (req.file) child.profilePhoto = await StorageService.uploadBuffer(`children/${child._id}/profile`, req.file);
    await child.save();
    await CareCircleMembership.create({
      childId: child._id,
      userId: req.user!._id,
      role: req.user!.caregiverRole ?? 'parent',
      relationship: req.user!.caregiverRole ?? 'parent',
      permissions: { canView: true, canComment: true, canObserve: true, canInvite: true, canManage: true }
    });
    ok(res, 'Child created', childResponse(child), 201);
  })
);

childrenRouter.get(
  '/children/selector',
  asyncHandler(async (req, res) => {
    const ids = await AccessibleChildrenService.idsForUser(req.user!._id.toString());
    const children = await Child.find({ _id: { $in: ids }, status: { $ne: 'deleted' } }).select('fullName nickname profilePhoto dateOfBirth');
    ok(
      res,
      'Child selector',
      children.map((child) => ({
        id: child._id,
        profileImage: child.profilePhoto?.url,
        name: child.nickname ?? child.fullName,
        age: calculateAge(child.dateOfBirth),
        developmentalAge: null,
        active: req.user!.activeChildId?.toString() === child._id.toString()
      }))
    );
  })
);

childrenRouter.get(
  '/children',
  asyncHandler(async (req, res) => {
    const ids = await AccessibleChildrenService.idsForUser(req.user!._id.toString());
    const children = await Child.find({ _id: { $in: ids }, status: { $ne: 'deleted' } }).sort({ createdAt: -1 });
    ok(res, 'Children', children.map(childResponse));
  })
);

childrenRouter.get('/children/:childId', requireChildAccess(), asyncHandler(async (req, res) => {
  const child = await Child.findById(req.params.childId);
  ok(res, 'Child', child ? childResponse(child) : null);
}));

childrenRouter.patch(
  '/children/:childId',
  requireChildOwner(),
  validate(updateChildSchema),
  asyncHandler(async (req, res) => {
    const payload = Object.fromEntries(Object.entries(childPayload(req.body)).filter(([, value]) => value !== undefined));
    console.log('Updating child with payload:', payload);
    const child = await Child.findByIdAndUpdate(req.params.childId, { $set: payload }, { new: true });
    ok(res, 'Child updated', child ? childResponse(child) : null);
  })
);

childrenRouter.delete('/children/:childId', requireChildOwner(), asyncHandler(async (req, res) => {
  await Child.updateOne({ _id: req.params.childId }, { $set: { status: 'deleted', deletedAt: new Date() } });
  ok(res, 'Child deleted');
}));

childrenRouter.get('/children/:childId/development-progress', requireChildAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Development progress', await DevelopmentScoringService.calculateChildProgress(req.params.childId));
}));

childrenRouter.get('/children/:childId/observation-summary', requireChildAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Observation summary', await DevelopmentScoringService.calculateObservationSummary(req.params.childId));
}));

childrenRouter.get('/children/:childId/dashboard', requireChildAccess(), asyncHandler(async (req, res) => {
  const child = await Child.findById(req.params.childId);
  const [progress, observationSummary, careCircle, recentActivities] = await Promise.all([
    DevelopmentScoringService.calculateChildProgress(req.params.childId),
    DevelopmentScoringService.calculateObservationSummary(req.params.childId),
    CareCircleMembership.find({ childId: req.params.childId, status: 'active' }).populate('userId', 'fullName profilePhoto caregiverRole daycareRole'),
    Observation.find({ childId: req.params.childId, status: 'active' })
      .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name title')
      .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
      .sort({ createdAt: -1 })
      .limit(10)
  ]);
  const activityCounts = await SocialResponseService.observationCountMaps(recentActivities.map((item) => item._id));
  ok(res, 'Dashboard', {
    child,
    todayInsight: { disclaimer: 'AI insights are guidance only, not a diagnosis.' },
    developmentProgress: progress.domains,
    observationSummary,
    pediatricReport: { overallScore: DevelopmentScoringService.calculateOverallScore(progress.domains) },
    careCircle,
    recentActivities: SocialResponseService.observations(recentActivities, activityCounts)
  });
}));

childrenRouter.get('/children/:childId/activities', requireChildAccess(), asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const total = await Observation.countDocuments({ childId: req.params.childId, status: 'active' });
  const activities = await Observation.find({ childId: req.params.childId, status: 'active' })
    .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name title')
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const counts = await SocialResponseService.observationCountMaps(activities.map((item) => item._id));
  paginated(res, 'Activities', SocialResponseService.observations(activities, counts), page, limit, total);
}));

childrenRouter.get('/children/:childId/activity-history', requireChildAccess(), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { childId: req.params.childId, status: 'active' };
  if (req.query.domain) filter.domainId = req.query.domain;
  const activities = await Observation.find(filter)
    .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name title')
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
    .sort({ occurredAt: -1 });
  const counts = await SocialResponseService.observationCountMaps(activities.map((item) => item._id));
  ok(res, 'Activity history', SocialResponseService.observations(activities, counts));
}));

childrenRouter.get('/children/:childId/milestones', requireChildAccess(), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { childId: req.params.childId, isMilestone: true, status: 'active' };
  if (req.query.domain) filter.domainId = req.query.domain;
  const milestones = await Observation.find(filter)
    .populate('childId', 'fullName nickname profilePhoto dateOfBirth gender')
    .populate('domainId indicatorId', 'name title')
    .populate('authorId', 'fullName email profilePhoto caregiverRole daycareRole userType')
    .sort({ occurredAt: -1 });
  const counts = await SocialResponseService.observationCountMaps(milestones.map((item) => item._id));
  ok(res, 'Milestones', SocialResponseService.observations(milestones, counts));
}));

childrenRouter.get('/children/:childId/achievements', requireChildAccess(), asyncHandler(async (req, res) => {
  const achievements = await Observation.find({ childId: req.params.childId, isMilestone: true, status: 'active' })
    .populate('childId', 'fullName nickname profilePhoto dateOfBirth gender')
    .populate('domainId indicatorId', 'name title')
    .populate('authorId', 'fullName email profilePhoto caregiverRole daycareRole userType')
    .sort({ occurredAt: -1 });
  const counts = await SocialResponseService.observationCountMaps(achievements.map((item) => item._id));
  ok(res, 'Achievements', SocialResponseService.observations(achievements, counts));
}));

childrenRouter.get('/children/:childId/reports/development', requireChildAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Development report', await ReportService.developmentReport(req.params.childId));
}));

childrenRouter.get('/children/:childId/reports/development/pdf', requireChildAccess(), asyncHandler(async (req, res) => {
  const pdf = await ReportService.developmentReportPdf(req.params.childId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="development-report.pdf"');
  res.send(pdf);
}));

childrenRouter.post('/children/:childId/reports/:reportId/share', requireChildOwner(), asyncHandler(async (_req, res) => {
  ok(res, 'Report share link requested', { status: 'pending_email_delivery' });
}));

childrenRouter.get('/children/:childId/expert-guidance', requireChildAccess(), asyncHandler(async (req, res) => {
  const report = await ReportService.developmentReport(req.params.childId);
  ok(res, 'Expert guidance', {
    disclaimer: 'This report is generated from caregiver-submitted observations and AI-assisted analysis. It is not a clinical diagnosis and should not replace professional pediatric evaluation.',
    suggestions: report.positiveHighlights.items.map((item) => item.text),
    questionsToDiscuss: report.recommendedQuestions.items.map((item) => item.question)
  });
}));

childrenRouter.patch('/children/:childId/profile-photo', requireChildOwner(), upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new Error('Photo is required');
  const media = await import('../../services/StorageService').then((m) => m.StorageService.uploadBuffer(`children/${req.params.childId}/profile`, req.file!));
  const child = await Child.findByIdAndUpdate(req.params.childId, { $set: { profilePhoto: media } }, { new: true });
  ok(res, 'Child profile photo updated', { profileImage: child?.profilePhoto?.url ?? null });
}));

childrenRouter.post(
  '/children/:childId/daycare-invitations',
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
    if (invitation.email) {
      void EmailService.daycareInvite(invitation.email, token, child.fullName).catch((error) => {
        console.error('Failed to send daycare invitation email', error);
      });
    }
    ok(res, 'Daycare invitation queued', { invitationId: invitation._id, emailStatus: 'queued' }, 201);
  })
);
