import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, paginated } from '../../utils/apiResponse';
import { Notification } from './notification.model';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/notifications', asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const filter = { userId: req.user!._id };
  const total = await Notification.countDocuments(filter);
  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  paginated(res, 'Notifications', notifications, page, limit, total);
}));

notificationsRouter.get('/notifications/unread-count', asyncHandler(async (req, res) => {
  ok(res, 'Unread notification count', { count: await Notification.countDocuments({ userId: req.user!._id, read: false }) });
}));

notificationsRouter.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
  ok(res, 'Notification read', await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user!._id }, { $set: { read: true, readAt: new Date() } }, { new: true }));
}));

notificationsRouter.patch('/notifications/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: req.user!._id, read: false }, { $set: { read: true, readAt: new Date() } });
  ok(res, 'All notifications read');
}));

notificationsRouter.delete('/notifications/:id', asyncHandler(async (req, res) => {
  await Notification.deleteOne({ _id: req.params.id, userId: req.user!._id });
  ok(res, 'Notification deleted');
}));

notificationsRouter.delete('/notifications/clear-all', asyncHandler(async (req, res) => {
  await Notification.deleteMany({ userId: req.user!._id });
  ok(res, 'Notifications cleared');
}));
