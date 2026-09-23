import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth } from '../../middlewares/auth';
import { requirePlatformAdmin } from '../../middlewares/authorization';
import { validate } from '../../middlewares/validate';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, paginated } from '../../utils/apiResponse';
import { paginationFromQuery, paginationQuerySchema } from '../../utils/pagination';
import { Child } from '../children/child.model';
import { CareCircleMembership } from '../care-circle/care-circle-membership.model';
import { Classroom } from '../classrooms/classroom.model';
import { Daycare } from '../daycare/daycare.model';
import { DaycareChildAssignment } from '../daycare/daycare-child-assignment.model';
import { Notification } from '../notifications/notification.model';
import { Observation } from '../observations/observation.model';
import { SupportIssue } from '../support/support-issue.model';
import { SupportMessage } from '../support/support-message.model';
import { Subscription } from '../subscriptions/subscription.model';
import { User } from '../users/user.model';
import { DevelopmentDomain } from '../domains/development-domain.model';
import { NotificationService } from '../../services/NotificationService';
import { emitSupportMessage, emitSupportTicket, emitSupportTicketDeleted } from '../../socket';

export const adminRouter = Router();

adminRouter.use(requireAuth, requirePlatformAdmin);

const publicUserFields = '-passwordHash -passwordResetTokenHash -passwordResetExpiresAt';

const startOfDay = (date = new Date()) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const daysAgo = (days: number) => {
  const value = startOfDay();
  value.setDate(value.getDate() - days);
  return value;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const ticketTitleFromMessage = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Support chat';
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
};

const legacyAutoReplyText = 'Thanks for reaching out! Let me help you with that. Could you provide more details?';
const nonLegacySupportMessageFilter = { text: { $ne: legacyAutoReplyText } };

let supportBackfillCheckedAt = 0;
let supportBackfillPromise: Promise<void> | null = null;

const backfillSupportTickets = async () => {
  if (Date.now() - supportBackfillCheckedAt < 5 * 60 * 1000) return;
  if (supportBackfillPromise) return supportBackfillPromise;

  supportBackfillPromise = (async () => {
  const startedAt = Date.now();
  const [messageUserIds, issueUserIds] = await Promise.all([
    SupportMessage.distinct('userId'),
    SupportIssue.distinct('userId')
  ]);
  const existingIssueUserIds = new Set(issueUserIds.map((userId) => userId.toString()));
  const missingUserIds = messageUserIds.filter((userId) => !existingIssueUserIds.has(userId.toString()));

  if (missingUserIds.length === 0) {
    supportBackfillCheckedAt = Date.now();
        return;
  }

  const latestMessages = await SupportMessage.aggregate([
    { $match: { userId: { $in: missingUserIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$userId', latest: { $first: '$$ROOT' } } }
  ]);

  await SupportIssue.insertMany(
    latestMessages.map((item) => ({
      userId: item._id,
      title: ticketTitleFromMessage(item.latest.text),
      description: item.latest.text,
      urgency: 'low',
      status: 'open'
    })),
    { ordered: false }
  );
  supportBackfillCheckedAt = Date.now();
    })().finally(() => {
    supportBackfillPromise = null;
  });

  return supportBackfillPromise;
};

const removeLegacyAutoReplies = () =>
  SupportMessage.deleteMany({ sender: 'support', text: legacyAutoReplyText }).catch(() => {});

const formatAge = (dateOfBirth: Date) => {
  const now = new Date();
  let months = (now.getFullYear() - dateOfBirth.getFullYear()) * 12 + now.getMonth() - dateOfBirth.getMonth();
  if (now.getDate() < dateOfBirth.getDate()) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years === 0) return `${remainingMonths} month${remainingMonths === 1 ? '' : 's'}`;
  if (remainingMonths === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years} year${years === 1 ? '' : 's'} ${remainingMonths} month${remainingMonths === 1 ? '' : 's'}`;
};

const monthKey = (date: Date) => date.toLocaleString('en-US', { month: 'short' });
const dayKey = (date: Date) => date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
const weekdayKey = (date: Date) => date.toLocaleString('en-US', { weekday: 'short' });

const objectIdOrThrow = (id: string, label: string) => {
  if (!Types.ObjectId.isValid(id)) throw new AppError(`${label} is invalid`, 400);
  return new Types.ObjectId(id);
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const userRoleLabel = (userType: string) => (userType === 'daycare' ? 'Daycare' : userType === 'admin' ? 'Admin' : 'Parent');
const userStatus = (status: string) => (status === 'disabled' ? 'Blocked' : status === 'deleted' ? 'Deleted' : status === 'pending' ? 'Pending' : 'Active');
let dashboardCache: { expiresAt: number; data: unknown } | null = null;
let observationStatsCache:
  | { expiresAt: number; data: { total: number; today: number; byDaycare: number; byParent: number } }
  | null = null;

const dashboardWindow = () =>
  Array.from({ length: 7 }, (_, index) => {
    const date = daysAgo(6 - index);
    return date;
  });

adminRouter.get('/dashboard', asyncHandler(async (_req, res) => {
  if (dashboardCache && dashboardCache.expiresAt > Date.now()) {
    ok(res, 'Admin dashboard', dashboardCache.data);
    return;
  }

  const today = startOfDay();
  const weekStart = daysAgo(6);

  const [
    totalDaycares,
    totalChildren,
    dailyObservations,
    totalCareCircle,
    parents,
    daycareUsers,
    openTickets,
    flaggedObservations,
    activityUsers,
    observationTrend,
    recentObservations
  ] = await Promise.all([
    Daycare.countDocuments({ status: 'active' }),
    Child.countDocuments({ status: 'active' }),
    Observation.countDocuments({ status: 'active', occurredAt: { $gte: today } }),
    CareCircleMembership.countDocuments({ status: 'active' }),
    User.countDocuments({ userType: 'caregiver', status: { $ne: 'deleted' } }),
    User.countDocuments({ userType: 'daycare', status: { $ne: 'deleted' } }),
    SupportIssue.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    Observation.countDocuments({ status: 'active', aiMetadata: { $exists: true } }),
    User.aggregate([
      { $match: { userType: { $in: ['caregiver', 'daycare'] }, status: { $ne: 'deleted' }, createdAt: { $gte: weekStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: 1 } } }
    ]),
    Observation.aggregate([
      { $match: { status: 'active', occurredAt: { $gte: weekStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } }, value: { $sum: 1 } } }
    ]),
    Observation.find({ status: 'active' })
      .populate('authorId', 'fullName')
      .populate('childId', 'fullName')
      .sort({ occurredAt: -1 })
      .limit(5)
      .lean()
  ]);

  const activityByDay = new Map(activityUsers.map((item) => [item._id, item.value]));
  const observationsByDay = new Map(observationTrend.map((item) => [item._id, item.value]));
  const dates = dashboardWindow();

  const data = {
    stats: {
      totalDaycares,
      totalChildren,
      dailyObservations,
      activeCareCircle: totalCareCircle
    },
    userActivityData: dates.map((date) => ({ name: dayKey(date), value: activityByDay.get(date.toISOString().slice(0, 10)) ?? 0 })),
    rolesData: [
      { name: 'Parents', value: parents, color: '#00b4d8' },
      { name: 'Daycare', value: daycareUsers, color: '#ff9f1c' }
    ],
    observationsData: dates.map((date) => ({ name: weekdayKey(date), value: observationsByDay.get(date.toISOString().slice(0, 10)) ?? 0 })),
    recentActivity: recentObservations.map((observation: any) => {
      const authorName = observation.authorId?.fullName ?? 'Unknown caregiver';
      const childName = observation.childId?.fullName ?? 'a child';
      return {
        initial: initials(authorName),
        name: authorName,
        desc: `Added ${observation.type} observation for ${childName}`,
        time: observation.occurredAt,
        flag: Boolean(observation.aiMetadata?.flagged)
      };
    }),
    alerts: [
      { id: 'support-open', type: 'warning', title: `${openTickets} support tickets need attention`, time: 'Live' },
      { id: 'ai-review', type: 'danger', title: `${flaggedObservations} AI-reviewed observations available`, time: 'Live' },
      { id: 'api-health', type: 'info', title: 'Admin API connected successfully', time: 'Now' }
    ]
  };

  dashboardCache = { expiresAt: Date.now() + 10_000, data };
  ok(res, 'Admin dashboard', data);
}));

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const filter: Record<string, unknown> = { userType: { $in: ['caregiver', 'daycare'] }, status: { $ne: 'deleted' } };

  if (role === 'Parent') filter.userType = 'caregiver';
  if (role === 'Daycare') filter.userType = 'daycare';
  if (status === 'Active') filter.status = 'active';
  if (status === 'Blocked') filter.status = 'disabled';
  if (status === 'Pending') filter.status = 'pending';
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phoneNumber: { $regex: search, $options: 'i' } }
    ];
  }

  const [total, users, roleCounts] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).select(publicUserFields).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.aggregate([
      { $match: { userType: { $in: ['caregiver', 'daycare'] }, status: { $ne: 'deleted' } } },
      { $group: { _id: '$userType', count: { $sum: 1 } } }
    ])
  ]);

  const userIds = users.map((user) => user._id);
  const [childrenByCaregiver, daycares, daycareChildren] = await Promise.all([
    Child.find({ status: { $ne: 'deleted' }, $or: [{ createdBy: { $in: userIds } }, { caregivers: { $in: userIds } }] }).select('fullName dateOfBirth gender profilePhoto status createdBy caregivers daycare developmentOverallScore').lean(),
    Daycare.find({ ownerId: { $in: userIds }, status: { $ne: 'deleted' } }).select('_id ownerId name').lean(),
    Child.find({ status: { $ne: 'deleted' }, daycare: { $exists: true } }).select('fullName dateOfBirth gender profilePhoto status daycare classroom developmentOverallScore').lean()
  ]);

  const daycareIdByOwner = new Map(daycares.map((daycare) => [daycare.ownerId.toString(), daycare._id.toString()]));
  const childPayload = (child: any) => ({
    id: child._id.toString(),
    name: child.fullName,
    dob: child.dateOfBirth,
    age: formatAge(child.dateOfBirth),
    gender: child.gender,
    image: typeof child.profilePhoto === 'string' ? child.profilePhoto : child.profilePhoto?.url ?? null,
    development: child.developmentOverallScore == null ? 'No development score yet.' : `Overall development score: ${Math.round(child.developmentOverallScore)}%`,
    status: child.status === 'active' ? 'Active' : 'Inactive'
  });

  const data = users.map((user) => {
    const userId = user._id.toString();
    const daycareId = daycareIdByOwner.get(userId);
    const relatedChildren = user.userType === 'daycare'
      ? daycareChildren.filter((child: any) => child.daycare?.toString() === daycareId)
      : childrenByCaregiver.filter((child: any) => child.createdBy?.toString() === userId || child.caregivers?.some((caregiverId: Types.ObjectId) => caregiverId.toString() === userId));

    return {
      id: userId,
      name: user.fullName,
      email: user.email,
      phone: user.phoneNumber ?? '',
      role: userRoleLabel(user.userType),
      status: userStatus(user.status),
      blocked: user.status === 'disabled',
      createdDate: user.createdAt,
      initials: initials(user.fullName),
      daycareId,
      children: relatedChildren.map(childPayload),
      childIds: relatedChildren.map((child: any) => child._id.toString())
    };
  });

  res.json({
    success: true,
    message: 'Admin users',
    data,
    meta: {
      counts: {
        Parent: roleCounts.find((item) => item._id === 'caregiver')?.count ?? 0,
        Daycare: roleCounts.find((item) => item._id === 'daycare')?.count ?? 0
      }
    },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

adminRouter.patch(
  '/users/:userId/status',
  validate(z.object({ body: z.object({ status: z.enum(['active', 'disabled', 'deleted']) }) })),
  asyncHandler(async (req, res) => {
    const user = await User.findOneAndUpdate(
      { _id: objectIdOrThrow(req.params.userId, 'User id'), userType: { $in: ['caregiver', 'daycare'] } },
      { $set: { status: req.body.status, deletedAt: req.body.status === 'deleted' ? new Date() : undefined } },
      { new: true }
    ).select(publicUserFields);
    if (!user) throw new AppError('User not found', 404);
    ok(res, 'User status updated', user);
  })
);

adminRouter.delete('/users/:userId', asyncHandler(async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: objectIdOrThrow(req.params.userId, 'User id'), userType: { $in: ['caregiver', 'daycare'] } },
    { $set: { status: 'deleted', deletedAt: new Date() } },
    { new: true }
  ).select(publicUserFields);
  if (!user) throw new AppError('User not found', 404);
  ok(res, 'User deleted', user);
}));

adminRouter.get('/children', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const filter: Record<string, unknown> = { status: { $ne: 'deleted' } };
  if (search) filter.fullName = { $regex: search, $options: 'i' };

  const [total, children, active, observations] = await Promise.all([
    Child.countDocuments(filter),
    Child.find(filter).populate('createdBy', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Child.countDocuments({ status: 'active' }),
    Observation.countDocuments({ status: 'active' })
  ]);

  const childIds = children.map((child) => child._id);
  const [observationCounts, milestoneCounts, careCircleCounts, latestObservations] = await Promise.all([
    Observation.aggregate([{ $match: { childId: { $in: childIds }, status: 'active' } }, { $group: { _id: '$childId', count: { $sum: 1 } } }]),
    Observation.aggregate([{ $match: { childId: { $in: childIds }, status: 'active', isMilestone: true } }, { $group: { _id: '$childId', count: { $sum: 1 } } }]),
    CareCircleMembership.aggregate([{ $match: { childId: { $in: childIds }, status: 'active' } }, { $group: { _id: '$childId', count: { $sum: 1 } } }]),
    Observation.aggregate([{ $match: { childId: { $in: childIds }, status: 'active' } }, { $sort: { occurredAt: -1 } }, { $group: { _id: '$childId', latest: { $first: '$occurredAt' } } }])
  ]);

  const countMap = new Map(observationCounts.map((item) => [item._id.toString(), item.count]));
  const milestoneMap = new Map(milestoneCounts.map((item) => [item._id.toString(), item.count]));
  const careMap = new Map(careCircleCounts.map((item) => [item._id.toString(), item.count]));
  const latestMap = new Map(latestObservations.map((item) => [item._id.toString(), item.latest]));

  paginated(
    res,
    'Admin children',
    children.map((child: any) => ({
      id: child._id.toString(),
      initials: initials(child.fullName),
      name: child.fullName,
      age: formatAge(child.dateOfBirth),
      born: child.dateOfBirth,
      parents: child.createdBy?.fullName ?? 'Unknown',
      observations: countMap.get(child._id.toString()) ?? 0,
      milestones: milestoneMap.get(child._id.toString()) ?? 0,
      careCircle: careMap.get(child._id.toString()) ?? 0,
      lastActivity: latestMap.get(child._id.toString()) ?? child.updatedAt,
      blocked: child.status === 'archived',
      status: child.status,
      developmentProgress: child.developmentProgress ?? []
    })),
    page,
    limit,
    total
  );
  res.locals.adminChildrenStats = { total, active, observations };
}));

adminRouter.get('/children-summary', asyncHandler(async (_req, res) => {
  const [total, active, observations, ages] = await Promise.all([
    Child.countDocuments({ status: { $ne: 'deleted' } }),
    Child.countDocuments({ status: 'active' }),
    Observation.countDocuments({ status: 'active' }),
    Child.find({ status: { $ne: 'deleted' } }).select('dateOfBirth').lean()
  ]);
  const totalMonths = ages.reduce((sum, child) => {
    const dob = child.dateOfBirth;
    const now = new Date();
    return sum + Math.max(0, (now.getFullYear() - dob.getFullYear()) * 12 + now.getMonth() - dob.getMonth());
  }, 0);
  const avgMonths = ages.length ? Math.round(totalMonths / ages.length) : 0;
  ok(res, 'Admin children summary', {
    total,
    active,
    observations,
    avgAge: avgMonths >= 12 ? `${Math.round((avgMonths / 12) * 10) / 10} yrs` : `${avgMonths} mos`
  });
}));

adminRouter.patch(
  '/children/:childId/status',
  validate(z.object({ body: z.object({ status: z.enum(['active', 'archived', 'deleted']) }) })),
  asyncHandler(async (req, res) => {
    const child = await Child.findByIdAndUpdate(
      objectIdOrThrow(req.params.childId, 'Child id'),
      { $set: { status: req.body.status, deletedAt: req.body.status === 'deleted' ? new Date() : undefined } },
      { new: true }
    );
    if (!child) throw new AppError('Child not found', 404);
    ok(res, 'Child status updated', child);
  })
);

adminRouter.get('/daycares/:daycareId/classrooms', asyncHandler(async (req, res) => {
  const daycareId = objectIdOrThrow(req.params.daycareId, 'Daycare id');
  const daycare = await Daycare.findOne({ _id: daycareId, status: { $ne: 'deleted' } });
  if (!daycare) throw new AppError('Daycare not found', 404);

  const [classrooms, children] = await Promise.all([
    Classroom.find({ daycareId, status: { $ne: 'archived' } }).sort({ name: 1 }),
    Child.find({ daycare: daycareId, status: { $ne: 'deleted' } }).sort({ fullName: 1 })
  ]);

  const payloadForChild = (child: InstanceType<typeof Child>) => ({
    id: child._id.toString(),
    name: child.fullName,
    initials: initials(child.fullName),
    dob: child.dateOfBirth,
    age: formatAge(child.dateOfBirth),
    gender: child.gender,
    status: child.status,
    blocked: child.status === 'archived',
    classroomId: child.classroom?.toString() ?? null
  });

  const classroomPayload = classrooms.map((classroom) => ({
    id: classroom._id.toString(),
    name: classroom.name,
    ageBand: classroom.ageBand ?? null,
    capacity: classroom.capacity ?? null,
    status: classroom.status,
    children: children.filter((child) => child.classroom?.toString() === classroom._id.toString()).map(payloadForChild)
  }));

  ok(res, 'Admin daycare classrooms', {
    daycare: { id: daycare._id.toString(), name: daycare.name },
    classrooms: classroomPayload,
    unassignedChildren: children.filter((child) => !child.classroom).map(payloadForChild)
  });
}));

adminRouter.post(
  '/classrooms/:classroomId/children',
  validate(z.object({ body: z.object({ childIds: z.array(z.string().refine((value) => Types.ObjectId.isValid(value), 'Child id must be valid')).min(1) }) })),
  asyncHandler(async (req, res) => {
    const classroom = await Classroom.findOne({ _id: objectIdOrThrow(req.params.classroomId, 'Classroom id'), status: { $ne: 'archived' } });
    if (!classroom) throw new AppError('Classroom not found', 404);
    const childIds = req.body.childIds.map((id: string) => objectIdOrThrow(id, 'Child id'));

    const children = await Child.find({ _id: { $in: childIds }, daycare: classroom.daycareId, status: { $ne: 'deleted' } });
    if (children.length !== childIds.length) throw new AppError('All children must belong to the classroom daycare', 403);

    await Promise.all(
      childIds.map((childId: Types.ObjectId) =>
        DaycareChildAssignment.updateOne(
          { daycareId: classroom.daycareId, childId },
          {
            $set: {
              daycareId: classroom.daycareId,
              childId,
              classroomId: classroom._id,
              assignedBy: req.user!._id,
              acceptedBy: req.user!._id,
              acceptedAt: new Date(),
              status: 'active'
            }
          },
          { upsert: true }
        )
      )
    );
    await Child.updateMany({ _id: { $in: childIds } }, { $set: { classroom: classroom._id, daycare: classroom.daycareId } });

    ok(res, 'Children moved to classroom', {
      classroomId: classroom._id.toString(),
      childIds: childIds.map(String)
    });
  })
);

adminRouter.get('/observations', asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { page, limit, skip } = paginationFromQuery(req.query);
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const filter: Record<string, unknown> = { status: 'active' };
  if (type && type !== 'All Types') filter.type = type;
  if (search) filter.$or = [{ title: { $regex: search, $options: 'i' } }, { text: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
  const parsedAt = Date.now();
  const hasListFilter = Boolean(type && type !== 'All Types') || Boolean(search);

  const timings: Record<string, number> = {};
  const timed = async <T>(label: string, promise: Promise<T>) => {
    const stepStartedAt = Date.now();
    const result = await promise;
    timings[label] = Date.now() - stepStartedAt;
    return result;
  };

  const statsPromise =
    observationStatsCache && observationStatsCache.expiresAt > Date.now()
      ? Promise.resolve(observationStatsCache.data).then((data) => {
          timings.stats = 0;
          return data;
        })
      : timed('stats', Promise.all([
          timed('statsTotal', Observation.countDocuments({ status: 'active' })),
          timed('statsToday', Observation.countDocuments({ status: 'active', occurredAt: { $gte: startOfDay() } })),
          timed('statsByDaycare', Observation.countDocuments({ status: 'active', daycareId: { $exists: true } })),
          timed('statsByParent', Observation.countDocuments({ status: 'active', daycareId: { $exists: false } }))
        ])).then(([total, today, byDaycare, byParent]) => {
          const data = { total, today, byDaycare, byParent };
          observationStatsCache = { expiresAt: Date.now() + 30_000, data };
          return data;
        });

  const observationsQuery = Observation.find(filter)
    .select('type title text description childId authorId occurredAt domainId stage aiMetadata')
    .sort({ occurredAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  if (!search) {
    observationsQuery.hint(
      type && type !== 'All Types'
        ? { status: 1, type: 1, occurredAt: -1 }
        : { status: 1, occurredAt: -1 }
    );
  }

  const [stats, rawObservations] = await Promise.all([
    statsPromise,
    timed('findObservations', observationsQuery)
  ]);
  const relationStartedAt = Date.now();
  const childIds = [...new Set(rawObservations.map((observation: any) => observation.childId?.toString()).filter(Boolean))];
  const authorIds = [...new Set(rawObservations.map((observation: any) => observation.authorId?.toString()).filter(Boolean))];
  const domainIds = [...new Set(rawObservations.map((observation: any) => observation.domainId?.toString()).filter(Boolean))];
  const [children, authors, domains] = await Promise.all([
    timed('lookupChildren', Child.find({ _id: { $in: childIds } }).select('fullName').lean()),
    timed('lookupAuthors', User.find({ _id: { $in: authorIds } }).select('fullName').lean()),
    timed('lookupDomains', DevelopmentDomain.find({ _id: { $in: domainIds } }).select('name slug').lean())
  ]);
  timings.lookupRelations = Date.now() - relationStartedAt;
  const childById = new Map(children.map((child: any) => [child._id.toString(), child]));
  const authorById = new Map(authors.map((author: any) => [author._id.toString(), author]));
  const domainById = new Map(domains.map((domain: any) => [domain._id.toString(), domain]));
  const observations = rawObservations.map((observation: any) => ({
    ...observation,
    childId: childById.get(observation.childId?.toString()),
    authorId: authorById.get(observation.authorId?.toString()),
    domainId: domainById.get(observation.domainId?.toString())
  }));
  const total = hasListFilter
    ? await timed('totalCount', Observation.countDocuments(filter))
    : (() => {
        timings.totalCount = 0;
        return stats.total;
      })();
  const queriedAt = Date.now();
  const payload = observations.map((observation: any) => ({
    id: observation._id.toString(),
    type: observation.type,
    title: observation.title || observation.text || 'Untitled observation',
    subtitle: observation.description || observation.text || '',
    child: observation.childId?.fullName ?? 'Unknown child',
    author: observation.authorId?.fullName ?? 'Unknown author',
    time: observation.occurredAt,
    domain: observation.domainId
      ? {
          id: observation.domainId._id?.toString?.() ?? observation.domainId.toString(),
          name: observation.domainId.name ?? null
        }
      : null,
    domainId: observation.domainId?._id?.toString?.() ?? observation.domainId?.toString?.() ?? null,
    domainName: observation.domainId?.name ?? null,
    tags: [observation.domainId?.name, observation.stage].filter(Boolean),
    insights: observation.aiMetadata ? 1 : 0,
    status: observation.aiMetadata ? ['Processed'] : ['Pending']
  }));
  const mappedAt = Date.now();
  
  res.json({
    success: true,
    message: 'Admin observations',
    data: payload,
    stats: { total, today: stats.today, byDaycare: stats.byDaycare, byParent: stats.byParent },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

adminRouter.delete('/observations/:observationId', asyncHandler(async (req, res) => {
  const observation = await Observation.findByIdAndUpdate(objectIdOrThrow(req.params.observationId, 'Observation id'), { $set: { status: 'deleted' } }, { new: true });
  if (!observation) throw new AppError('Observation not found', 404);
  ok(res, 'Observation deleted', observation);
}));

adminRouter.get('/milestones-ai', asyncHandler(async (_req, res) => {
  const today = startOfDay();
  const weekStart = daysAgo(6);
  const days = dashboardWindow();

  const [
    totalMilestones,
    aiProcessed,
    flaggedForReview,
    activity,
    domains,
    domainMilestones,
    domainPending
  ] = await Promise.all([
    Observation.countDocuments({ status: 'active', isMilestone: true }),
    Observation.countDocuments({ status: 'active', aiMetadata: { $exists: true } }),
    Observation.countDocuments({ status: 'active', 'aiMetadata.flagged': true }),
    Observation.aggregate([
      { $match: { status: 'active', occurredAt: { $gte: weekStart } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
          processed: { $sum: { $cond: [{ $ifNull: ['$aiMetadata', false] }, 1, 0] } },
          milestones: { $sum: { $cond: ['$isMilestone', 1, 0] } }
        }
      }
    ]),
    DevelopmentDomain.find({ status: 'active' }).sort({ sortOrder: 1, name: 1 }).select('name slug sortOrder').lean(),
    Observation.aggregate([
      { $match: { status: 'active', isMilestone: true, domainId: { $exists: true } } },
      { $group: { _id: '$domainId', achieved: { $sum: 1 } } }
    ]),
    Observation.aggregate([
      { $match: { status: 'active', isMilestone: { $ne: true }, domainId: { $exists: true } } },
      { $group: { _id: '$domainId', pending: { $sum: 1 } } }
    ])
  ]);

  const activityByDay = new Map(activity.map((item) => [item._id, item]));
  const milestoneByDomain = new Map(domainMilestones.map((item) => [item._id.toString(), item.achieved]));
  const pendingByDomain = new Map(domainPending.map((item) => [item._id.toString(), item.pending]));
  const accurate = Math.max(aiProcessed - flaggedForReview, 0);
  const accuracyRate = aiProcessed > 0 ? Math.round((accurate / aiProcessed) * 1000) / 10 : 0;
  const reviewedPercent = aiProcessed > 0 ? Math.round((flaggedForReview / aiProcessed) * 100) : 0;
  const accuratePercent = aiProcessed > 0 ? Math.max(0, 100 - reviewedPercent) : 0;

  const domainStats = domains.map((domain) => {
    const id = domain._id.toString();
    const achieved = milestoneByDomain.get(id) ?? 0;
    const pending = pendingByDomain.get(id) ?? 0;
    const total = achieved + pending;
    return {
      id,
      name: domain.name,
      achieved,
      pending,
      total,
      completionRate: total > 0 ? Math.round((achieved / total) * 1000) / 10 : 0
    };
  });

  ok(res, 'Admin milestones and AI analytics', {
    stats: {
      totalMilestones,
      aiProcessed,
      accuracyRate,
      flaggedForReview
    },
    lineData: days.map((date) => {
      const key = date.toISOString().slice(0, 10);
      const item = activityByDay.get(key);
      return {
        name: weekdayKey(date),
        processed: item?.processed ?? 0,
        milestones: item?.milestones ?? 0
      };
    }),
    pieData: [
      { name: 'Accurate', value: accuratePercent, color: '#10b981' },
      { name: 'Reviewed', value: reviewedPercent, color: '#f59e0b' },
      { name: 'Corrected', value: 0, color: '#ef4444' }
    ],
    barData: domainStats.map((domain) => ({
      name: domain.name,
      achieved: domain.achieved,
      pending: domain.pending
    })),
    domains: domainStats
  });
}));

adminRouter.get('/domains', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { status: 'active' };
  const [total, domains] = await Promise.all([
    DevelopmentDomain.countDocuments(filter),
    DevelopmentDomain.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(limit)
  ]);

  const domainIds = domains.map((domain) => domain._id);
  const observationCounts = await Observation.aggregate([
    { $match: { status: 'active', domainId: { $in: domainIds } } },
    { $group: { _id: '$domainId', count: { $sum: 1 } } }
  ]);
  const countMap = new Map(observationCounts.map((item) => [item._id.toString(), item.count]));

  paginated(
    res,
    'Admin domains',
    domains.map((domain) => ({
      id: domain._id.toString(),
      name: domain.name,
      slug: domain.slug,
      description: domain.description ?? '',
      sortOrder: domain.sortOrder ?? 0,
      status: domain.status,
      observationCount: countMap.get(domain._id.toString()) ?? 0,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt
    })),
    page,
    limit,
    total
  );
}));

adminRouter.post(
  '/domains',
  validate(z.object({ body: z.object({ name: z.string().trim().min(1, 'Domain name is required') }) })),
  asyncHandler(async (req, res) => {
    const name = req.body.name.trim();
    const slug = slugify(name);
    if (!slug) throw new AppError('Domain name must include letters or numbers', 400);

    const existing = await DevelopmentDomain.findOne({ slug });
    if (existing?.status === 'active') throw new AppError('Domain already exists', 409);

    const domain = existing
      ? await DevelopmentDomain.findByIdAndUpdate(existing._id, { $set: { name, slug, status: 'active' } }, { new: true })
      : await DevelopmentDomain.create({ name, slug });
    const observationCount = await Observation.countDocuments({ status: 'active', domainId: domain!._id });
    void NotificationService.createDomainCreatedNotifications(domain!._id.toString(), domain!.name, req.user!._id.toString()).catch(() => {});

    ok(res, 'Domain created', {
      id: domain!._id.toString(),
      name: domain!.name,
      slug: domain!.slug,
      description: domain!.description ?? '',
      sortOrder: domain!.sortOrder ?? 0,
      status: domain!.status,
      observationCount,
      createdAt: domain!.createdAt,
      updatedAt: domain!.updatedAt
    }, 201);
  })
);

adminRouter.patch(
  '/domains/:domainId',
  validate(z.object({
    params: z.object({ domainId: z.string().refine((value) => Types.ObjectId.isValid(value), 'Domain id must be valid') }),
    body: z.object({ name: z.string().trim().min(1, 'Domain name is required') })
  })),
  asyncHandler(async (req, res) => {
    const domainId = objectIdOrThrow(req.params.domainId, 'Domain id');
    const name = req.body.name.trim();
    const slug = slugify(name);
    if (!slug) throw new AppError('Domain name must include letters or numbers', 400);

    const duplicate = await DevelopmentDomain.findOne({ _id: { $ne: domainId }, slug });
    if (duplicate) throw new AppError('Domain already exists', 409);

    const domain = await DevelopmentDomain.findOneAndUpdate(
      { _id: domainId, status: 'active' },
      { $set: { name, slug } },
      { new: true }
    );
    if (!domain) throw new AppError('Domain not found', 404);

    const observationCount = await Observation.countDocuments({ status: 'active', domainId: domain._id });
    ok(res, 'Domain updated', {
      id: domain._id.toString(),
      name: domain.name,
      slug: domain.slug,
      description: domain.description ?? '',
      sortOrder: domain.sortOrder ?? 0,
      status: domain.status,
      observationCount,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt
    });
  })
);

adminRouter.delete('/domains/:domainId', asyncHandler(async (req, res) => {
  const domain = await DevelopmentDomain.findOneAndUpdate(
    { _id: objectIdOrThrow(req.params.domainId, 'Domain id'), status: 'active' },
    { $set: { status: 'inactive' } },
    { new: true }
  );
  if (!domain) throw new AppError('Domain not found', 404);

  const observationCount = await Observation.countDocuments({ status: 'active', domainId: domain._id });
  ok(res, 'Domain deleted', {
    id: domain._id.toString(),
    name: domain.name,
    slug: domain.slug,
    status: domain.status,
    observationCount
  });
}));

adminRouter.get('/notifications', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const adminUserIds = await User.find({ userType: 'admin', status: { $ne: 'deleted' } }).distinct('_id');
  const filter = { userId: { $in: adminUserIds } };
  const [total, notifications] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.find(filter).populate('userId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(limit)
  ]);
  paginated(
    res,
    'Admin notifications',
    notifications.map((notification: any) => ({
      id: notification._id.toString(),
      type: notification.type,
      title: notification.title,
      message: notification.body ?? '',
      date: notification.createdAt,
      read: notification.read,
      link: notification.data?.link ?? null,
      data: notification.data ?? {},
      user: notification.userId ? { name: notification.userId.fullName, email: notification.userId.email } : null
    })),
    page,
    limit,
    total
  );
}));

adminRouter.patch('/notifications/:notificationId/read', asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    objectIdOrThrow(req.params.notificationId, 'Notification id'),
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  );
  if (!notification) throw new AppError('Notification not found', 404);
  ok(res, 'Notification marked read', notification);
}));

adminRouter.patch('/notifications/read-all', asyncHandler(async (_req, res) => {
  const adminUserIds = await User.find({ userType: 'admin', status: { $ne: 'deleted' } }).distinct('_id');
  const result = await Notification.updateMany({ userId: { $in: adminUserIds }, read: false }, { $set: { read: true, readAt: new Date() } });
  ok(res, 'Notifications marked read', { modifiedCount: result.modifiedCount });
}));

adminRouter.get('/support/tickets', asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { page, limit, skip } = paginationFromQuery(req.query);
  const parsedAt = Date.now();
  void removeLegacyAutoReplies();
  void backfillSupportTickets().catch(() => {});
  const backfilledAt = Date.now();

  const [total, issues] = await Promise.all([
    SupportIssue.countDocuments({}),
    SupportIssue.find({}).populate('userId', 'fullName email').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean()
  ]);
  const issuesFetchedAt = Date.now();
  const userIds = issues.map((issue) => issue.userId?._id).filter(Boolean);
  const latestMessages = await SupportMessage.aggregate([
    { $match: { userId: { $in: userIds }, text: { $ne: legacyAutoReplyText } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$userId', latest: { $first: '$$ROOT' }, count: { $sum: 1 } } }
  ]);
  const messagesAggregatedAt = Date.now();
  const latestMap = new Map(latestMessages.map((item) => [item._id.toString(), item]));
  
  paginated(
    res,
    'Admin support tickets',
    issues.map((issue: any) => {
      const user = issue.userId;
      const latest = user ? latestMap.get(user._id.toString()) : null;
      return {
        id: issue._id.toString(),
        userId: user?._id?.toString(),
        title: issue.title,
        description: issue.description,
        urgency: issue.urgency,
        status: issue.status,
        parentName: user?.fullName ?? 'Unknown user',
        parentEmail: user?.email ?? '',
        parentInitials: initials(user?.fullName ?? 'Unknown user'),
        lastActivity: latest?.latest?.createdAt ?? issue.updatedAt,
        attachment: issue.attachments?.[0]?.originalName ?? issue.attachments?.[0]?.url ?? null,
        messageCount: latest?.count ?? 0
      };
    }),
    page,
    limit,
    total
  );
}));

adminRouter.get('/support/tickets/:userId/messages', asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { page, limit } = paginationFromQuery(req.query);
  const userId = objectIdOrThrow(req.params.userId, 'User id');
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
  const messageFilter: Record<string, unknown> = { userId, ...nonLegacySupportMessageFilter };
  if (before && !Number.isNaN(before.getTime())) messageFilter.createdAt = { $lt: before };
  const parsedAt = Date.now();
  void removeLegacyAutoReplies();
  const [total, messagesDesc] = await Promise.all([
    SupportMessage.countDocuments({ userId, ...nonLegacySupportMessageFilter }),
    SupportMessage.find(messageFilter).sort({ createdAt: -1 }).limit(limit + 1).lean()
  ]);
  const hasMore = messagesDesc.length > limit;
  const messages = messagesDesc.slice(0, limit).reverse();
  const messagesFetchedAt = Date.now();
    res.json({
    success: true,
    message: 'Admin support messages',
    data: messages.map((message) => ({
      id: message._id.toString(),
      sender: message.sender === 'support' ? 'agent' : 'parent',
      senderName: message.sender === 'support' ? 'Support Team' : 'Parent',
      text: message.text,
      time: message.createdAt
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore }
  });
}));

adminRouter.post(
  '/support/tickets/:userId/messages',
  validate(z.object({ body: z.object({ text: z.string().min(1) }) })),
  asyncHandler(async (req, res) => {
    const userId = objectIdOrThrow(req.params.userId, 'User id');
    const message = await SupportMessage.create({ userId, sender: 'support', text: req.body.text, status: 'sent' });
    emitSupportMessage(message);
    ok(res, 'Support reply sent', {
      id: message._id.toString(),
      sender: 'agent',
      senderName: 'Support Team',
      text: message.text,
      time: message.createdAt
    }, 201);
  })
);

adminRouter.patch(
  '/support/tickets/:ticketId/status',
  validate(z.object({ body: z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']) }) })),
  asyncHandler(async (req, res) => {
    const issue = await SupportIssue.findByIdAndUpdate(objectIdOrThrow(req.params.ticketId, 'Ticket id'), { $set: { status: req.body.status } }, { new: true });
    if (!issue) throw new AppError('Support ticket not found', 404);
    const user = await User.findById(issue.userId);
    if (user) emitSupportTicket(issue, user);
    ok(res, 'Support ticket status updated', issue);
  })
);

adminRouter.delete('/support/tickets/:ticketId', asyncHandler(async (req, res) => {
  const issue = await SupportIssue.findByIdAndDelete(objectIdOrThrow(req.params.ticketId, 'Ticket id'));
  if (!issue) throw new AppError('Support ticket not found', 404);
  emitSupportTicketDeleted(issue._id.toString());
  ok(res, 'Support ticket deleted', issue);
}));

adminRouter.get('/subscriptions', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const plan = typeof req.query.plan === 'string' ? req.query.plan : undefined;
  const filter: Record<string, unknown> = {};
  if (status && status !== 'All Subs') filter.status = status.toLowerCase();
  if (plan && plan !== 'Plan Type') filter.planName = plan;

  const [total, subscriptions] = await Promise.all([
    Subscription.countDocuments(filter),
    Subscription.find(filter).populate('userId', 'fullName email').sort({ updatedAt: -1 }).skip(skip).limit(limit)
  ]);

  paginated(
    res,
    'Admin subscriptions',
    subscriptions.map((subscription: any) => ({
      id: subscription._id.toString(),
      name: subscription.userId?.fullName ?? 'Unknown user',
      email: subscription.userId?.email ?? '',
      plan: subscription.planName,
      date: subscription.renewsAt ?? subscription.updatedAt,
      payment: subscription.paymentMethodLabel ?? 'Card',
      status: subscription.status === 'active' ? 'Active' : subscription.status === 'cancelled' ? 'Cancelled' : 'Expiring',
      amountCents: subscription.amountCents,
      currency: subscription.currency,
      interval: subscription.planInterval
    })),
    page,
    limit,
    total
  );
}));

adminRouter.get('/subscriptions/summary', asyncHandler(async (_req, res) => {
  const [subscriptions, revenueByMonth] = await Promise.all([
    Subscription.find({}).lean(),
    Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: { month: { $month: '$createdAt' }, interval: '$planInterval' }, amount: { $sum: '$amountCents' }, count: { $sum: 1 } } }
    ])
  ]);

  const active = subscriptions.filter((subscription) => subscription.status === 'active');
  const yearly = active.filter((subscription) => subscription.planInterval === 'yearly');
  const monthly = active.filter((subscription) => subscription.planInterval === 'monthly');
  const revenue = active.reduce((sum, subscription) => sum + subscription.amountCents, 0);
  const monthNames = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (6 - index));
    return date;
  });

  ok(res, 'Admin subscription summary', {
    metrics: {
      totalSubscribers: subscriptions.length,
      monthlyRevenue: revenue / 100,
      yearlyMembersPercent: active.length ? Math.round((yearly.length / active.length) * 100) : 0,
      renewalRate: subscriptions.length ? Math.round((active.length / subscriptions.length) * 100) : 0
    },
    activePlans: [
      { name: 'Monthly Membership', price: 29, interval: 'mo', subscribers: monthly.length, conversion: active.length ? Math.round((monthly.length / active.length) * 100) : 0 },
      { name: 'Yearly Membership', price: 249, interval: 'yr', subscribers: yearly.length, conversion: active.length ? Math.round((yearly.length / active.length) * 100) : 0 }
    ],
    revenueGrowth: monthNames.map((date) => {
      const month = date.getMonth() + 1;
      const monthlyAmount = revenueByMonth.find((item) => item._id.month === month && item._id.interval === 'monthly')?.amount ?? 0;
      const yearlyAmount = revenueByMonth.find((item) => item._id.month === month && item._id.interval === 'yearly')?.amount ?? 0;
      return { month: monthKey(date).toUpperCase(), val1: Math.round(monthlyAmount / 100), val2: Math.round(yearlyAmount / 100) };
    }),
    recentActivity: active.slice(0, 5).map((subscription) => ({
      id: subscription._id.toString(),
      type: 'success',
      title: 'Subscription Active',
      desc: `${subscription.planName} - ${subscription.currency} ${(subscription.amountCents / 100).toFixed(2)}`
    }))
  });
}));

adminRouter.get('/schema', validate(z.object({ query: z.object({ ...paginationQuerySchema }).partial() })), (_req, res) => {
  ok(res, 'Admin API schema', {
    routes: [
      'GET /admin/dashboard',
      'GET /admin/users',
      'PATCH /admin/users/:userId/status',
      'DELETE /admin/users/:userId',
      'GET /admin/children',
      'GET /admin/children-summary',
      'PATCH /admin/children/:childId/status',
      'GET /admin/observations',
      'DELETE /admin/observations/:observationId',
      'GET /admin/domains',
      'POST /admin/domains',
      'PATCH /admin/domains/:domainId',
      'DELETE /admin/domains/:domainId',
      'GET /admin/notifications',
      'PATCH /admin/notifications/:notificationId/read',
      'PATCH /admin/notifications/read-all',
      'GET /admin/support/tickets',
      'GET /admin/support/tickets/:userId/messages',
      'POST /admin/support/tickets/:userId/messages',
      'PATCH /admin/support/tickets/:ticketId/status',
      'DELETE /admin/support/tickets/:ticketId',
      'GET /admin/subscriptions',
      'GET /admin/subscriptions/summary'
    ]
  });
});
