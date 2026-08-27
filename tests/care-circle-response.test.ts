import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { CareCircleMembership } from '../src/modules/care-circle/care-circle-membership.model';
import { Child } from '../src/modules/children/child.model';
import { Daycare } from '../src/modules/daycare/daycare.model';
import { DaycareChildAssignment } from '../src/modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../src/modules/daycare/daycare-member.model';
import { User } from '../src/modules/users/user.model';
import { TokenService } from '../src/services/TokenService';

let mongo: MongoMemoryServer;
const app = createApp();

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

const makeParent = (email: string, name = email) =>
  User.create({
    fullName: name,
    email,
    passwordHash: 'hash',
    userType: 'caregiver',
    caregiverRole: 'parent',
    status: 'active'
  });

const makeDaycareUser = (email: string, name = email) =>
  User.create({
    fullName: name,
    email,
    passwordHash: 'hash',
    userType: 'daycare',
    daycareRole: 'daycare_admin',
    status: 'active'
  });

describe('care circle response', () => {
  it('returns child parents, care-circle caregivers, and associated daycare users', async () => {
    const owner = await makeParent('owner@example.com', 'Owner Parent');
    const caregiver = await makeParent('caregiver@example.com', 'Second Parent');
    const invitedCaregiver = await makeParent('invited@example.com', 'Invited Caregiver');
    const daycareOwner = await makeDaycareUser('daycare-owner@example.com', 'Daycare Owner');
    const daycareStaff = await makeDaycareUser('daycare-staff@example.com', 'Daycare Staff');
    const daycare = await Daycare.create({ name: 'Bright Start', ownerId: daycareOwner._id, status: 'active' });
    const child = await Child.create({
      fullName: 'A Child',
      dateOfBirth: new Date('2022-01-01'),
      createdBy: owner._id,
      caregivers: [owner._id, caregiver._id],
      daycare: daycare._id
    });

    await CareCircleMembership.create({
      childId: child._id,
      userId: invitedCaregiver._id,
      role: 'nanny',
      relationship: 'nanny',
      status: 'active'
    });
    await DaycareMember.create({ daycareId: daycare._id, userId: daycareOwner._id, role: 'daycare_admin', status: 'active' });
    await DaycareMember.create({ daycareId: daycare._id, userId: daycareStaff._id, role: 'daycare_employee', status: 'active' });
    await DaycareChildAssignment.create({ childId: child._id, daycareId: daycare._id, assignedBy: owner._id, status: 'active' });

    const response = await request(app)
      .get(`/api/v1/children/${child._id}/care-circle?limit=20`)
      .set('Authorization', `Bearer ${TokenService.signAccessToken(owner._id)}`)
      .expect(200);

    const names = response.body.data.map((member: any) => member.userId?.fullName).sort();
    expect(names).toEqual([
      'Daycare Owner',
      'Daycare Staff',
      'Invited Caregiver',
      'Owner Parent',
      'Second Parent'
    ]);
    expect(response.body.pagination.total).toBe(5);
    expect(response.body.data.filter((member: any) => member.relationship === 'daycare')).toHaveLength(2);
  });
});
