import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.route';
import { legalRouter } from '../modules/legal/legal.route';
import { profileRouter } from '../modules/profile/profile.route';
import { settingsRouter } from '../modules/settings/settings.route';
import { childrenRouter } from '../modules/children/children.route';
import { careCircleRouter } from '../modules/care-circle/care-circle.route';
import { daycareRouter } from '../modules/daycare/daycare.route';
import { classroomsRouter } from '../modules/classrooms/classrooms.route';
import { domainsRouter } from '../modules/domains/domains.route';
import { observationsRouter } from '../modules/observations/observations.route';
import { feedRouter } from '../modules/feed/feed.route';
import { commentsRouter } from '../modules/comments/comments.route';
import { reactionsRouter } from '../modules/reactions/reactions.route';
import { notificationsRouter } from '../modules/notifications/notifications.route';
import { reportsRouter } from '../modules/reports/reports.route';
import { aiRouter } from '../modules/ai/ai.route';
import { supportRouter } from '../modules/support/support.route';
import { requireAuth } from '../middlewares/auth';
import { ok } from '../utils/apiResponse';

export const v1Router = Router();

v1Router.get('/health', (_req, res) => ok(res, 'API healthy', { version: 'v1' }));
v1Router.use('/auth', authRouter);
v1Router.use('/legal', legalRouter);
v1Router.use('/profile', profileRouter);
v1Router.use('/settings', settingsRouter);
v1Router.use(childrenRouter);
v1Router.use(careCircleRouter);
v1Router.use(daycareRouter);
v1Router.use(classroomsRouter);
v1Router.use(domainsRouter);
v1Router.use(observationsRouter);
v1Router.use(feedRouter);
v1Router.use(commentsRouter);
v1Router.use(reactionsRouter);
v1Router.use(notificationsRouter);
v1Router.use(reportsRouter);
v1Router.use(aiRouter);
v1Router.use(supportRouter);

v1Router.delete('/account', requireAuth, async (req, res) => {
  req.user!.status = 'deleted';
  req.user!.deletedAt = new Date();
  await req.user!.save();
  ok(res, 'Account deleted');
});

v1Router.get('/milestones', requireAuth, (_req, res) => ok(res, 'Use /children/:childId/milestones for milestone data', []));
v1Router.get('/achievements', requireAuth, (_req, res) => ok(res, 'Use /children/:childId/achievements for achievement data', []));
v1Router.get('/expert-guidance', requireAuth, (_req, res) => ok(res, 'Use /children/:childId/expert-guidance for child-specific guidance', []));
