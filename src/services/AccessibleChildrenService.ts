import { Child } from '../modules/children/child.model';
import { CareCircleMembership } from '../modules/care-circle/care-circle-membership.model';
import { DaycareChildAssignment } from '../modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../modules/daycare/daycare-member.model';

export class AccessibleChildrenService {
  static async idsForUser(userId: string) {
    const owned = await Child.find({ createdBy: userId, status: { $ne: 'deleted' } }).distinct('_id');
    const memberships = await CareCircleMembership.find({ userId, status: 'active' }).distinct('childId');
    const daycareIds = await DaycareMember.find({ userId, status: 'active' }).distinct('daycareId');
    const daycareChildren = daycareIds.length
      ? await DaycareChildAssignment.find({ daycareId: { $in: daycareIds }, status: 'active' }).distinct('childId')
      : [];
    return [...new Set([...owned, ...memberships, ...daycareChildren].map(String))];
  }
}
