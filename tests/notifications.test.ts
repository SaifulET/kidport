import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationService } from '../src/services/NotificationService';
import { ObservationService } from '../src/services/ObservationService';
import { CareCircleMembership } from '../src/modules/care-circle/care-circle-membership.model';
import { Child } from '../src/modules/children/child.model';
import { Daycare } from '../src/modules/daycare/daycare.model';
import { DaycareChildAssignment } from '../src/modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../src/modules/daycare/daycare-member.model';
import { DevelopmentDomain } from '../src/modules/domains/development-domain.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const makeParent = (email: string) =>
  User.create({
    fullName: email,
    email,
    passwordHash: 'hash',
    userType: 'caregiver',
    caregiverRole: 'parent',
    status: 'active'
  });

const makeDaycareUser = (email: string) =>
  User.create({
    fullName: email,
    email,
    passwordHash: 'hash',
    userType: 'daycare',
    daycareRole: 'daycare_admin',
    status: 'active'
  });

const makeAssociatedChild = async () => {
  const parent = await makeParent('parent@example.com');
  const daycareUser = await makeDaycareUser('daycare@example.com');
  const daycare = await Daycare.create({ name: 'Bright Start', ownerId: daycareUser._id, status: 'active' });
  const child = await Child.create({
    fullName: 'A Child',
    dateOfBirth: new Date('2022-01-01'),
    gender: 'female',
    createdBy: parent._id,
    caregivers: [parent._id],
    daycare: daycare._id
  });
  const domain = await DevelopmentDomain.create({ name: 'Social Emotional', slug: 'social-emotional' });
  await CareCircleMembership.create({
    childId: child._id,
    userId: parent._id,
    role: 'parent',
    relationship: 'parent',
    status: 'active'
  });
  await DaycareMember.create({
    daycareId: daycare._id,
    userId: daycareUser._id,
    role: 'daycare_admin',
    status: 'active'
  });
  await DaycareChildAssignment.create({
    childId: child._id,
    daycareId: daycare._id,
    assignedBy: parent._id,
    status: 'active'
  });
  return { parent, daycareUser, daycare, child, domain };
};

describe('NotificationService event recipients', () => {
  it('notifies associated daycare users when a parent creates an observation', async () => {
    const { parent, daycareUser, child, daycare, domain } = await makeAssociatedChild();

    await ObservationService.create({
      childId: child._id.toString(),
      authorId: parent._id.toString(),
      authorRelationship: 'caregiver',
      daycareId: daycare._id.toString(),
      type: 'text',
      text: 'Practiced sharing blocks with a friend.',
      domainId: domain._id.toString(),
      stage: 'steady'
    });

    await expect(Notification.countDocuments({ userId: daycareUser._id, type: 'observation_created' })).resolves.toBe(1);
    await expect(Notification.countDocuments({ userId: parent._id, type: 'observation_created' })).resolves.toBe(0);
  });

  it('notifies parents when daycare creates a milestone observation', async () => {
    const { parent, daycareUser, child, daycare, domain } = await makeAssociatedChild();

    await ObservationService.create({
      childId: child._id.toString(),
      authorId: daycareUser._id.toString(),
      authorRelationship: 'daycare',
      daycareId: daycare._id.toString(),
      type: 'text',
      text: 'Used a full sentence to ask another child to play.',
      domainId: domain._id.toString(),
      stage: 'confident'
    });

    await expect(Notification.countDocuments({ userId: parent._id, type: 'milestone_achieved' })).resolves.toBe(1);
    await expect(Notification.countDocuments({ userId: daycareUser._id, type: 'milestone_achieved' })).resolves.toBe(0);
  });

  it('notifies daycare and parent users when a new domain is created', async () => {
    const parent = await makeParent('parent@example.com');
    const daycareUser = await makeDaycareUser('daycare@example.com');
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@example.com',
      passwordHash: 'hash',
      userType: 'admin',
      status: 'active'
    });
    const domain = await DevelopmentDomain.create({ name: 'Language', slug: 'language' });

    await NotificationService.createDomainCreatedNotifications(domain._id.toString(), domain.name, admin._id.toString());

    await expect(Notification.countDocuments({ userId: parent._id, type: 'domain_created' })).resolves.toBe(1);
    await expect(Notification.countDocuments({ userId: daycareUser._id, type: 'domain_created' })).resolves.toBe(1);
    await expect(Notification.countDocuments({ userId: admin._id, type: 'domain_created' })).resolves.toBe(0);
  });

  it('notifies the invited daycare when a parent sends a child invitation', async () => {
    const { parent, daycareUser, child, daycare } = await makeAssociatedChild();

    await NotificationService.createChildInvitationNotifications({
      childId: child._id.toString(),
      invitationId: new mongoose.Types.ObjectId().toString(),
      daycareId: daycare._id.toString(),
      actorId: parent._id.toString(),
      actorName: parent.fullName,
      childName: child.fullName,
      invitedEmail: daycareUser.email,
      invitationType: 'daycare_child_assignment'
    });

    await expect(Notification.countDocuments({ userId: daycareUser._id, type: 'child_invitation_created' })).resolves.toBe(1);
  });
});
