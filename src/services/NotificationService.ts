import { Notification } from '../modules/notifications/notification.model';
import { User } from '../modules/users/user.model';

export class NotificationService {
  static create(userId: string, type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    return Notification.create({ userId, type, title, body, data });
  }

  static createMany(userIds: string[], type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    return Notification.insertMany(userIds.map((userId) => ({ userId, type, title, body, data })));
  }

  static async createForAdmins(type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    const adminIds = await User.find({ userType: 'admin', status: 'active' }).distinct('_id');
    if (adminIds.length === 0) return [];
    return this.createMany(adminIds.map(String), type, title, body, data);
  }
}
