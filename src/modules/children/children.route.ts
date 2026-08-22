import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { requireChildAccess, requireChildOwner } from '../../middlewares/authorization';
import { upload } from '../../middlewares/upload';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { ok } from '../../utils/apiResponse';
import { calculateAge } from '../../utils/date';
import { developmentalAgeDisplay } from '../../utils/developmentalAge';
import { randomToken, hashToken } from '../../utils/crypto';
import { DEVELOPMENT_STAGE_SCORE } from '../../constants/stages';
import { AccessibleChildrenService } from '../../services/AccessibleChildrenService';
import { DevelopmentScoringService } from '../../services/DevelopmentScoringService';
import { ObservationService } from '../../services/ObservationService';
import { ReportService } from '../../services/ReportService';
import { EmailService } from '../../services/EmailService';
import { StorageService } from '../../services/StorageService';
import { SocialResponseService } from '../../services/SocialResponseService';
import { Child } from './child.model';
import { CareCircleMembership } from '../care-circle/care-circle-membership.model';
import { User } from '../users/user.model';
import { Daycare } from '../daycare/daycare.model';
import { DaycareMember } from '../daycare/daycare-member.model';
import { DaycareChildAssignment } from '../daycare/daycare-child-assignment.model';
import { Invitation } from '../care-circle/invitation.model';
import { Observation } from '../observations/observation.model';

export const childrenRouter = Router();
childrenRouter.use(requireAuth);

const childResponse = (child: InstanceType<typeof Child>) => {
  const data = child.toObject();
  const { profilePhoto: _profilePhoto, ...rest } = data;
  return { ...rest, profileImage: child.profilePhoto?.url, age: calculateAge(child.dateOfBirth), developmentalAge: developmentalAgeDisplay(child.developmentalAge) };
};

const queryString = (value: unknown) => {
  const stringValue = Array.isArray(value) ? value[0] : value;
  return typeof stringValue === 'string' ? stringValue.trim() : undefined;
};

const applyObservationFilters = async (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const domain = queryString(query.domainName) ?? queryString(query.domain) ?? queryString(query.domainId);
  const keyword = queryString(query.keyword) ?? queryString(query.stage);
  const startDate = queryString(query.startDate);
  const endDate = queryString(query.endDate);
  if (domain) filter.domainId = await ObservationService.resolveDomainId(domain);
  if (keyword) filter.stage = keyword;
  if (startDate || endDate) {
    filter.occurredAt = {
      ...(startDate ? { $gte: new Date(startDate) } : {}),
      ...(endDate ? { $lte: new Date(endDate) } : {})
    };
  }
  return filter;
};

const visibleObservationStatusFilter = (authorId: unknown) => ({
  $or: [{ status: 'active' }, { status: 'draft', authorId }]
});

const applyObservationStatusFilter = (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const status = queryString(query.status);
  if (!status) return filter;
  if (status !== 'active' && status !== 'draft') throw new AppError('Status must be active or draft', 400);
  filter.status = status;
  return filter;
};

const emptyKeywordCounts = () => ({
  emerging: 0,
  building: 0,
  steady: 0,
  confident: 0
});

const keywordCountsForObservationFilter = async (filter: Record<string, unknown>) => {
  const keywordFilter = { ...filter };
  delete keywordFilter.stage;
  const keywords = Object.keys(DEVELOPMENT_STAGE_SCORE) as Array<keyof typeof DEVELOPMENT_STAGE_SCORE>;
  const counts = await Promise.all(
    keywords.map(async (keyword) => [keyword, await Observation.countDocuments({ ...keywordFilter, stage: keyword })] as const)
  );
  return { ...emptyKeywordCounts(), ...Object.fromEntries(counts) };
};

type DomainAnalytics = {
  domainId: string | null;
  domain: string | null;
  total: number;
  milestones: number;
  keywords: ReturnType<typeof emptyKeywordCounts>;
  scoreSum: number;
  scoreCount: number;
};

const childObservationAnalytics = async (childId: string, query: Record<string, unknown>) => {
  const filter = await applyObservationFilters({ childId, status: 'active' }, query);
  const observations = await Observation.find(filter)
    .populate('domainId', 'name slug')
    .select('domainId type stage stageScore isMilestone occurredAt')
    .sort({ occurredAt: 1 });

  const byKeyword = emptyKeywordCounts();
  const byType = { text: 0, voice: 0, photo: 0, video: 0 };
  const byDomain = new Map<string, DomainAnalytics>();
  let firstObservedAt: Date | null = null;
  let lastObservedAt: Date | null = null;
  let totalMilestones = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const observation of observations) {
    const data = observation.toObject() as {
      domainId?: { _id?: unknown; name?: string } | string;
      type?: keyof typeof byType;
      stage?: keyof typeof DEVELOPMENT_STAGE_SCORE;
      stageScore?: number;
      isMilestone?: boolean;
      occurredAt?: Date;
    };
    const stage = data.stage;
    const stageScore = data.stageScore ?? (stage ? DEVELOPMENT_STAGE_SCORE[stage] : undefined);

    if (stage) byKeyword[stage] += 1;
    if (data.type && data.type in byType) byType[data.type] += 1;
    if (data.isMilestone) totalMilestones += 1;
    if (typeof stageScore === 'number') {
      scoreSum += stageScore;
      scoreCount += 1;
    }
    if (data.occurredAt) {
      firstObservedAt ??= data.occurredAt;
      lastObservedAt = data.occurredAt;
    }

    const domainId = typeof data.domainId === 'object' && data.domainId?._id ? String(data.domainId._id) : data.domainId ? String(data.domainId) : null;
    const domainName = typeof data.domainId === 'object' ? data.domainId.name ?? null : null;
    const domainKey = domainId ?? 'unknown';
    const domain = byDomain.get(domainKey) ?? {
      domainId,
      domain: domainName,
      total: 0,
      milestones: 0,
      keywords: emptyKeywordCounts(),
      scoreSum: 0,
      scoreCount: 0
    };

    domain.total += 1;
    if (data.isMilestone) domain.milestones += 1;
    if (stage) domain.keywords[stage] += 1;
    if (typeof stageScore === 'number') {
      domain.scoreSum += stageScore;
      domain.scoreCount += 1;
    }
    byDomain.set(domainKey, domain);
  }

  return {
    childId,
    totalObservations: observations.length,
    totalMilestones,
    averageStageScore: scoreCount ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
    averageProgress: scoreCount ? Math.round((scoreSum / (4 * scoreCount)) * 100) : null,
    firstObservedAt,
    lastObservedAt,
    byKeyword,
    byType,
    byDomain: Array.from(byDomain.values()).map(({ scoreSum: domainScoreSum, scoreCount: domainScoreCount, ...domain }) => ({
      ...domain,
      averageProgress: domainScoreCount ? Math.round((domainScoreSum / (4 * domainScoreCount)) * 100) : null
    })),
    filters: {
      domain: queryString(query.domainName) ?? queryString(query.domain) ?? queryString(query.domainId) ?? null,
      keyword: queryString(query.keyword) ?? queryString(query.stage) ?? null,
      startDate: queryString(query.startDate) ?? null,
      endDate: queryString(query.endDate) ?? null
    },
    lastCalculatedAt: new Date()
  };
};

type DevelopmentReport = Awaited<ReturnType<typeof ReportService.developmentReport>>;
type DomainReport = DevelopmentReport['domainReports'][number];
type FlagToDiscuss = DevelopmentReport['flagsToDiscuss']['items'][number];

const normalizeDomainName = (value?: string) => value?.trim().toLowerCase();

const fallbackDomainGuidance = (domain: DomainReport) => {
  const domainName = domain.domain.toLowerCase();
  if (domain.observationCount === 0 || domain.status === 'not-enough-data') {
    return `Add a few ${domainName} observations across different days so the guidance can reflect real patterns.`;
  }
  if (domain.status === 'needs-support') {
    return `Use short, repeatable ${domainName} activities during daily routines and watch for small changes in confidence.`;
  }
  if (domain.status === 'improving') {
    return `Continue the ${domainName} activities that are working, and add one slightly harder step when the child seems comfortable.`;
  }
  return null;
};

const domainGuidanceFromReport = (report: DevelopmentReport) => {
  const flagsByDomain = report.flagsToDiscuss.items.reduce((map, flag) => {
    const domainKey = normalizeDomainName(flag.domain);
    if (!domainKey) return map;
    map.set(domainKey, [...(map.get(domainKey) ?? []), flag]);
    return map;
  }, new Map<string, FlagToDiscuss[]>());

  return report.domainReports.map((domain) => {
    const domainKey = normalizeDomainName(domain.domain);
    const flagGuidance = (domainKey ? flagsByDomain.get(domainKey) : undefined)?.map((flag) => flag.recommendation).filter(Boolean) ?? [];
    const fallbackGuidance = fallbackDomainGuidance(domain);
    const guidance = [...flagGuidance, ...(fallbackGuidance ? [fallbackGuidance] : [])];

    return {
      domain: domain.domain,
      guidance: guidance.length > 0 ? guidance : null
    };
  });
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
    const children = await Child.find({ _id: { $in: ids }, status: { $ne: 'deleted' } }).select('fullName nickname profilePhoto dateOfBirth developmentalAge');
    ok(
      res,
      'Child selector',
      children.map((child) => ({
        id: child._id,
        profileImage: child.profilePhoto?.url,
        name: child.nickname ?? child.fullName,
        age: calculateAge(child.dateOfBirth),
        developmentalAge: developmentalAgeDisplay(child.developmentalAge),
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
  upload.single('photo'),
  validate(updateChildSchema),
  asyncHandler(async (req, res) => {
    console.log('Received request to update child:', req.params.childId, 'with body:', req.body);
    const payload = Object.fromEntries(Object.entries(childPayload(req.body)).filter(([, value]) => value !== undefined));
    if (req.file) payload.profilePhoto = await StorageService.uploadBuffer(`children/${req.params.childId}/profile`, req.file);
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

childrenRouter.get('/children/:childId/observations/analytics', requireChildAccess(), asyncHandler(async (req, res) => {
  ok(res, 'Observation analytics', await childObservationAnalytics(req.params.childId, req.query));
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
    child: child ? childResponse(child) : null,
    todayInsight: { disclaimer: 'AI insights are guidance only, not a diagnosis.' },
    developmentProgress: progress.domains,
    observationSummary,
    pediatricReport: {
      overallScore: DevelopmentScoringService.calculateOverallScore(progress.domains),
      developmentalAge: developmentalAgeDisplay(child?.developmentalAge)
    },
    careCircle,
    recentActivities: SocialResponseService.observations(recentActivities, activityCounts)
  });
}));

childrenRouter.get('/children/:childId/activities', requireChildAccess(), asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const filter = applyObservationStatusFilter(
    await applyObservationFilters({ childId: req.params.childId, ...visibleObservationStatusFilter(req.user!._id) }, req.query),
    req.query
  );
  const [total, keywordCounts] = await Promise.all([
    Observation.countDocuments(filter),
    keywordCountsForObservationFilter(filter)
  ]);
  const activities = await Observation.find(filter)
    .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name title')
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const counts = await SocialResponseService.observationCountMaps(activities.map((item) => item._id));
  res.json({
    success: true,
    message: 'Activities',
    data: SocialResponseService.observations(activities, counts),
    keywordCounts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

childrenRouter.get('/children/:childId/activity-history', requireChildAccess(), asyncHandler(async (req, res) => {
  const filter = applyObservationStatusFilter(
    await applyObservationFilters({ childId: req.params.childId, ...visibleObservationStatusFilter(req.user!._id) }, req.query),
    req.query
  );
  const [activities, keywordCounts] = await Promise.all([
    Observation.find(filter)
      .populate('childId domainId indicatorId', 'fullName nickname profilePhoto name title')
      .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
      .sort({ occurredAt: -1 }),
    keywordCountsForObservationFilter(filter)
  ]);
  const counts = await SocialResponseService.observationCountMaps(activities.map((item) => item._id));
  res.json({
    success: true,
    message: 'Activity history',
    data: SocialResponseService.observations(activities, counts),
    keywordCounts
  });
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
    domainGuidance: domainGuidanceFromReport(report)
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
    const daycare = await Daycare.findOne({ _id: req.body.daycareId, status: 'active' });
    const child = await Child.findById(req.params.childId);
    if (!daycare || !child) throw new Error('Daycare or child not found');
    const daycareOwner = await User.findOne({ _id: daycare.ownerId, userType: 'daycare', status: 'active' });
    const daycareAdmin = daycareOwner
      ? await DaycareMember.findOne({ daycareId: daycare._id, userId: daycareOwner._id, role: 'daycare_admin', status: 'active' })
      : null;
    if (!daycareOwner || !daycareAdmin) throw new AppError('Daycare account must be approved before invitation', 403);

    const existingAssignment = await DaycareChildAssignment.findOne({
      childId: req.params.childId,
      daycareId: req.body.daycareId,
      status: { $in: ['pending', 'active'] }
    });
    if (existingAssignment) throw new AppError('This child is already invited or assigned to this daycare', 409);

    const pendingInvitation = await Invitation.findOne({
      type: 'daycare_child_assignment',
      childId: req.params.childId,
      daycareId: req.body.daycareId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    });
    if (pendingInvitation) throw new AppError('A pending daycare invitation already exists for this child and daycare', 409);

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
      { $set: { assignedBy: req.user!._id, status: 'pending' }, $unset: { classroomId: '' } },
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
