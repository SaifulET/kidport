import { Types } from 'mongoose';
import { CareCircleMembership } from '../modules/care-circle/care-circle-membership.model';
import { Child } from '../modules/children/child.model';
import { DaycareChildAssignment } from '../modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../modules/daycare/daycare-member.model';

export class AuthorizationService {
  static async getChildAccess(userId: string, childId: string) {
    if (!Types.ObjectId.isValid(childId)) return null;

    const child = await Child.findOne({ _id: childId, status: { $ne: 'deleted' } });
    if (!child) return null;

    const isOwner = child.createdBy.toString() === userId;
    if (isOwner) return { child, isOwner, daycareId: child.daycare?.toString() };

    const membership = await CareCircleMembership.findOne({ childId, userId, status: 'active' });
    if (membership) return { child, isOwner: false, daycareId: child.daycare?.toString() };

    const assignment = await DaycareChildAssignment.findOne({ childId, status: 'active' });
    if (assignment) {
      const member = await DaycareMember.findOne({
        daycareId: assignment.daycareId,
        userId,
        status: 'active'
      });
      if (member) return { child, isOwner: false, daycareId: assignment.daycareId.toString() };
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
