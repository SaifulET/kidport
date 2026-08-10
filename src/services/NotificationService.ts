import { Notification } from '../modules/notifications/notification.model';

export class NotificationService {
  static create(userId: string, type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    return Notification.create({ userId, type, title, body, data });
  }

  static createMany(userIds: string[], type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    return Notification.insertMany(userIds.map((userId) => ({ userId, type, title, body, data })));
  }
}
