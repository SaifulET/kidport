import { Types } from 'mongoose';
import { CareCircleMembership } from '../modules/care-circle/care-circle-membership.model';
import { Invitation } from '../modules/care-circle/invitation.model';
import { Child } from '../modules/children/child.model';
import { DaycareChildAssignment } from '../modules/daycare/daycare-child-assignment.model';
import { AppError } from '../utils/AppError';

const objectIdString = (value: unknown) => {
  if (typeof value === 'string' && Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value) {
    return value;
  }
  return null;
};

export class CareCircleService {
  static async removeMember(childId: string, memberId: string, actorId: string) {
    const child = await Child.findOne({ _id: childId, status: { $ne: 'deleted' } });
    if (!child) throw new AppError('Child not found', 404);

    const membershipId = objectIdString(memberId);
    if (membershipId) {
      const member = await CareCircleMembership.findOne({ _id: membershipId, childId, status: 'active' });
      if (member) {
        if (member.userId.toString() === actorId || child.createdBy.toString() === member.userId.toString()) {
          throw new AppError('The child owner cannot be removed from the care circle', 400);
        }
        member.status = 'removed';
        await member.save();
        await Child.updateOne({ _id: childId }, { $pull: { caregivers: member.userId } });
        return {
          type: 'care_circle' as const,
          memberId: member._id.toString(),
          userId: member.userId.toString(),
          status: 'removed'
        };
      }

      const invitation = await Invitation.findOne({ _id: membershipId, childId, status: 'pending' });
      if (invitation) {
        invitation.status = 'revoked';
        await invitation.save();
        if (invitation.type === 'daycare_child_assignment' && invitation.daycareId) {
          await this.unlinkDaycare(childId, invitation.daycareId.toString(), actorId);
        }
        return {
          type: 'invitation' as const,
          memberId: invitation._id.toString(),
          status: 'revoked'
        };
      }
    }

    const childUserMatch = /^child-user:[^:]+:(.+)$/.exec(memberId);
    if (childUserMatch) {
      const userId = childUserMatch[1];
      if (child.createdBy.toString() === userId) {
        throw new AppError('The child owner cannot be removed from the care circle', 400);
      }
      const pulled = await Child.updateOne({ _id: childId }, { $pull: { caregivers: userId } });
      const membership = await CareCircleMembership.findOneAndUpdate(
        { childId, userId, status: 'active' },
        { $set: { status: 'removed' } },
        { new: true }
      );
      if (!membership && pulled.modifiedCount === 0) throw new AppError('Care circle member not found', 404);
      return {
        type: 'child_caregiver' as const,
        memberId,
        userId,
        status: 'removed'
      };
    }

    const daycareMatch = /^daycare-(?:member|owner):([^:]+):/.exec(memberId);
    if (daycareMatch) {
      const removed = await this.unlinkDaycare(childId, daycareMatch[1], actorId);
      if (!removed) throw new AppError('Care circle member not found', 404);
      return {
        type: 'daycare' as const,
        memberId,
        daycareId: daycareMatch[1],
        status: 'removed'
      };
    }

    throw new AppError('Care circle member not found', 404);
  }

  private static async unlinkDaycare(childId: string, daycareId: string, actorId: string) {
    const assignment = await DaycareChildAssignment.findOneAndUpdate(
      { childId, daycareId, status: { $in: ['pending', 'active'] } },
      { $set: { status: 'revoked', revokedBy: actorId, revokedAt: new Date() } },
      { new: true }
    );
    const invitations = await Invitation.updateMany(
      { childId, daycareId, type: 'daycare_child_assignment', status: 'pending' },
      { $set: { status: 'revoked' } }
    );
    const child = await Child.findById(childId).select('daycare');
    const linkedOnChild = child?.daycare?.toString() === daycareId;
    if (linkedOnChild) {
      await Child.updateOne({ _id: childId }, { $unset: { daycare: 1 } });
    }
    return Boolean(assignment || invitations.modifiedCount || linkedOnChild);
  }
}
