import type { Types } from 'mongoose';
import { Daycare } from '../modules/daycare/daycare.model';
import { DaycareMember } from '../modules/daycare/daycare-member.model';
import { AppError } from '../utils/AppError';

type DaycareAccountProfile = {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  userType?: string;
  status?: string;
};

export class DaycareAccountService {
  static async ensureOwnerDaycare(user: DaycareAccountProfile) {
    const daycare = await Daycare.findOneAndUpdate(
      { ownerId: user._id, status: 'active' },
      { $setOnInsert: { name: user.fullName, email: user.email, ownerId: user._id, status: 'active' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await DaycareMember.findOneAndUpdate(
      { daycareId: daycare._id, userId: user._id },
      { $set: { role: 'daycare_admin', status: 'active' }, $setOnInsert: { classroomIds: [] } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return daycare;
  }

  static async getApprovedOwnerDaycare(user: DaycareAccountProfile) {
    if (user.userType !== 'daycare') throw new AppError('Only daycare accounts can use this endpoint', 403);
    if (user.status !== 'active') throw new AppError('Account approval required', 403);
    return this.ensureOwnerDaycare(user);
  }
}
