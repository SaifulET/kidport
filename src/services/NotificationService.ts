import { Notification } from '../modules/notifications/notification.model';
import { User } from '../modules/users/user.model';
import { CareCircleMembership } from '../modules/care-circle/care-circle-membership.model';
import { Child } from '../modules/children/child.model';
import { Daycare } from '../modules/daycare/daycare.model';
import { DaycareChildAssignment } from '../modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../modules/daycare/daycare-member.model';

type NotificationInput = {
  childId: string;
  observationId?: string;
  invitationId?: string;
  daycareId?: string;
  actorId?: string;
  childName?: string;
  actorName?: string;
  domainName?: string;
  observationType?: string;
  invitedEmail?: string;
  invitationType?: string;
  role?: string;
};

export class NotificationService {
  static create(userId: string, type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    return Notification.create({ userId, type, title, body, data });
  }

  static createMany(userIds: string[], type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    const ids = this.uniqueIds(userIds);
    if (ids.length === 0) return Promise.resolve([]);
    return Notification.insertMany(ids.map((userId) => ({ userId, type, title, body, data })));
  }

  static async createForAdmins(type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    const adminIds = await User.find({ userType: 'admin', status: 'active' }).distinct('_id');
    if (adminIds.length === 0) return [];
    return this.createMany(adminIds.map(String), type, title, body, data);
  }

  static async createForUserTypes(userTypes: string[], type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    const userIds = await User.find({ userType: { $in: userTypes }, status: 'active' }).distinct('_id');
    return this.createMany(userIds.map(String), type, title, body, data);
  }

  static uniqueIds(ids: Array<string | undefined | null>) {
    return [...new Set(ids.filter(Boolean).map(String))];
  }

  static withoutActor(ids: string[], actorId?: string) {
    return actorId ? ids.filter((id) => id !== actorId) : ids;
  }

  static async activeUserIds(ids: Array<string | undefined | null>) {
    const uniqueIds = this.uniqueIds(ids);
    if (uniqueIds.length === 0) return [];
    const activeIds = await User.find({ _id: { $in: uniqueIds }, status: 'active' }).distinct('_id');
    return activeIds.map(String);
  }

  static async caregiverUserIdsForChild(childId: string) {
    const [child, membershipIds] = await Promise.all([
      Child.findById(childId).select('createdBy caregivers'),
      CareCircleMembership.find({ childId, status: 'active' }).distinct('userId')
    ]);
    return this.activeUserIds([
      child?.createdBy?.toString(),
      ...(child?.caregivers ?? []).map(String),
      ...membershipIds.map(String)
    ]);
  }

  static async daycareUserIdsForDaycare(daycareId: string) {
    const [daycare, memberIds] = await Promise.all([
      Daycare.findOne({ _id: daycareId, status: { $ne: 'deleted' } }).select('ownerId'),
      DaycareMember.find({ daycareId, status: 'active' }).distinct('userId')
    ]);
    return this.activeUserIds([daycare?.ownerId?.toString(), ...memberIds.map(String)]);
  }

  static async daycareUserIdsForChild(childId: string, daycareId?: string) {
    const [child, assignments] = await Promise.all([
      Child.findById(childId).select('daycare'),
      DaycareChildAssignment.find({ childId, status: 'active' }).select('daycareId')
    ]);
    const daycareIds = this.uniqueIds([
      daycareId,
      child?.daycare?.toString(),
      ...assignments.map((assignment) => assignment.daycareId.toString())
    ]);
    const userIdGroups = await Promise.all(daycareIds.map((id) => this.daycareUserIdsForDaycare(id)));
    return this.uniqueIds(userIdGroups.flat());
  }

  static async stakeholderUserIdsForChild(childId: string, daycareId?: string) {
    const [caregiverIds, daycareIds] = await Promise.all([
      this.caregiverUserIdsForChild(childId),
      this.daycareUserIdsForChild(childId, daycareId)
    ]);
    return this.uniqueIds([...caregiverIds, ...daycareIds]);
  }

  static async createObservationNotifications(input: NotificationInput) {
    const recipients = this.withoutActor(
      await this.stakeholderUserIdsForChild(input.childId, input.daycareId),
      input.actorId
    );
    const actor = input.actorName ?? 'A caregiver';
    const observationLabel = input.observationType ? `${input.observationType} observation` : 'observation';
    return this.createMany(
      recipients,
      'observation_created',
      'New observation added',
      `${actor} added a ${observationLabel} for ${input.childName ?? 'a child'}.`,
      {
        childId: input.childId,
        observationId: input.observationId,
        daycareId: input.daycareId,
        domainName: input.domainName,
        link: '/observations'
      }
    );
  }

  static async createMilestoneNotifications(input: NotificationInput) {
    const recipients = this.withoutActor(
      await this.stakeholderUserIdsForChild(input.childId, input.daycareId),
      input.actorId
    );
    return this.createMany(
      recipients,
      'milestone_achieved',
      'New milestone achieved',
      `${input.childName ?? 'A child'} reached a confident milestone.`,
      {
        childId: input.childId,
        observationId: input.observationId,
        daycareId: input.daycareId,
        domainName: input.domainName,
        link: '/observations'
      }
    );
  }

  static async createDomainCreatedNotifications(domainId: string, domainName: string, actorId?: string) {
    const userIds = await User.find({ userType: { $in: ['caregiver', 'daycare'] }, status: 'active' }).distinct('_id');
    return this.createMany(
      this.withoutActor(userIds.map(String), actorId),
      'domain_created',
      'New development domain',
      `${domainName} is now available for observations.`,
      {
        domainId,
        domainName,
        link: '/observations'
      }
    );
  }

  static async createChildInvitationNotifications(input: NotificationInput) {
    const [childRecipients, daycareRecipients, invitedUser] = await Promise.all([
      this.stakeholderUserIdsForChild(input.childId, input.daycareId),
      input.daycareId ? this.daycareUserIdsForDaycare(input.daycareId) : Promise.resolve([]),
      input.invitedEmail ? User.findOne({ email: input.invitedEmail, status: 'active' }).select('_id') : Promise.resolve(null)
    ]);

    const recipients = this.withoutActor(
      this.uniqueIds([...childRecipients, ...daycareRecipients, invitedUser?._id?.toString()]),
      input.actorId
    );
    const actor = input.actorName ?? 'A parent';
    const title = input.invitationType === 'daycare_child_assignment' ? 'New daycare child invitation' : 'New care circle invitation';
    const body = input.invitationType === 'daycare_child_assignment'
      ? `${actor} invited your daycare to care for ${input.childName ?? 'a child'}.`
      : `${actor} invited ${input.invitedEmail ?? 'a caregiver'} to join ${input.childName ?? 'a child'}'s care circle.`;

    return this.createMany(recipients, 'child_invitation_created', title, body, {
      childId: input.childId,
      invitationId: input.invitationId,
      daycareId: input.daycareId,
      invitedEmail: input.invitedEmail,
      invitationType: input.invitationType,
      role: input.role,
      link: input.invitationType === 'daycare_child_assignment' ? '/daycare/invitations' : '/children'
    });
  }
}
