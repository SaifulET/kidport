import { Types } from 'mongoose';
import { CareCircleMembership } from '../modules/care-circle/care-circle-membership.model';
import { Child } from '../modules/children/child.model';
import { Daycare } from '../modules/daycare/daycare.model';
import { DaycareChildAssignment } from '../modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../modules/daycare/daycare-member.model';

export class AuthorizationService {
  private static async canAccessChildDaycare(userId: string, daycareId?: unknown) {
    if (!daycareId) return false;
    const [member, daycare] = await Promise.all([
      DaycareMember.findOne({ daycareId, userId, status: 'active' }),
      Daycare.findOne({ _id: daycareId, ownerId: userId, status: { $ne: 'deleted' } }).select('_id')
    ]);
    return Boolean(member || daycare);
  }

  static async getChildAccess(userId: string, childId: string) {
    if (!Types.ObjectId.isValid(childId)) return null;

    const child = await Child.findOne({ _id: childId, status: { $ne: 'deleted' } });
    if (!child) return null;

    const isOwner = child.createdBy.toString() === userId;
    if (isOwner) return { child, isOwner, daycareId: child.daycare?.toString() };

    const membership = await CareCircleMembership.findOne({ childId, userId, status: 'active' });
    if (membership) return { child, isOwner: false, daycareId: child.daycare?.toString() };

    if (await this.canAccessChildDaycare(userId, child.daycare)) {
      return { child, isOwner: false, daycareId: child.daycare?.toString() };
    }

    const assignment = await DaycareChildAssignment.findOne({ childId, status: 'active' });
    if (assignment) {
      if (await this.canAccessChildDaycare(userId, assignment.daycareId)) {
        return { child, isOwner: false, daycareId: assignment.daycareId.toString() };
      }
    }

    return null;
  }

  static async canManageDaycare(userId: string, daycareId: string) {
    const member = await DaycareMember.findOne({ daycareId, userId, status: 'active', role: 'daycare_admin' });
    return Boolean(member);
  }

  static async canAccessDaycare(userId: string, daycareId: string) {
    const member = await DaycareMember.findOne({ daycareId, userId, status: 'active' });
    return member;
  }
}
