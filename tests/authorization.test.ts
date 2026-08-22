import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationService } from '../src/services/AuthorizationService';
import { User } from '../src/modules/users/user.model';
import { Child } from '../src/modules/children/child.model';
import { Daycare } from '../src/modules/daycare/daycare.model';
import { DaycareMember } from '../src/modules/daycare/daycare-member.model';
import { DaycareChildAssignment } from '../src/modules/daycare/daycare-child-assignment.model';
import { Classroom } from '../src/modules/classrooms/classroom.model';

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

const makeUser = (email: string) =>
  User.create({
    fullName: email,
    email,
    passwordHash: 'hash',
    userType: 'caregiver',
    caregiverRole: 'parent'
  });

describe('AuthorizationService child access', () => {
  it('rejects a random user from another child', async () => {
    const owner = await makeUser('owner@example.com');
    const random = await makeUser('random@example.com');
    const child = await Child.create({ fullName: 'A Child', dateOfBirth: new Date('2022-01-01'), createdBy: owner._id });

    await expect(AuthorizationService.getChildAccess(random._id.toString(), child._id.toString())).resolves.toBeNull();
  });

  it('does not give daycare access before parent assignment is active', async () => {
    const owner = await makeUser('owner@example.com');
    const staff = await makeUser('staff@example.com');
    const child = await Child.create({ fullName: 'A Child', dateOfBirth: new Date('2022-01-01'), createdBy: owner._id });
    const daycare = await Daycare.create({ name: 'Sunflower', ownerId: staff._id });
    await DaycareMember.create({ daycareId: daycare._id, userId: staff._id, role: 'daycare_employee' });

    await expect(AuthorizationService.getChildAccess(staff._id.toString(), child._id.toString())).resolves.toBeNull();
  });

  it('allows daycare access after parent assignment is active', async () => {
    const owner = await makeUser('owner@example.com');
    const staff = await makeUser('staff@example.com');
    const child = await Child.create({ fullName: 'A Child', dateOfBirth: new Date('2022-01-01'), createdBy: owner._id });
    const daycare = await Daycare.create({ name: 'Sunflower', ownerId: staff._id });
    await DaycareMember.create({ daycareId: daycare._id, userId: staff._id, role: 'daycare_employee' });
    await DaycareChildAssignment.create({ childId: child._id, daycareId: daycare._id, assignedBy: owner._id, status: 'active' });

    const access = await AuthorizationService.getChildAccess(staff._id.toString(), child._id.toString());
    expect(access?.child._id.toString()).toBe(child._id.toString());
  });

  it('does not allow pending daycare members to access or manage daycare records', async () => {
    const admin = await makeUser('admin@example.com');
    const staff = await makeUser('staff@example.com');
    const daycare = await Daycare.create({ name: 'Sunflower', ownerId: admin._id });
    const member = await DaycareMember.create({
      daycareId: daycare._id,
      userId: staff._id,
      role: 'daycare_employee',
      status: 'pending'
    });

    await expect(AuthorizationService.canAccessDaycare(staff._id.toString(), daycare._id.toString())).resolves.toBeNull();
    await expect(AuthorizationService.canManageDaycare(staff._id.toString(), daycare._id.toString())).resolves.toBe(false);

    member.status = 'active';
    await member.save();

    await expect(AuthorizationService.canAccessDaycare(staff._id.toString(), daycare._id.toString())).resolves.toBeTruthy();
    await expect(AuthorizationService.canManageDaycare(staff._id.toString(), daycare._id.toString())).resolves.toBe(false);
  });

  it('represents classroom assignment only for an already assigned child', async () => {
    const owner = await makeUser('owner@example.com');
    const staff = await makeUser('staff@example.com');
    const child = await Child.create({ fullName: 'A Child', dateOfBirth: new Date('2022-01-01'), createdBy: owner._id });
    const daycare = await Daycare.create({ name: 'Rainbow', ownerId: staff._id });
    const classroom = await Classroom.create({ daycareId: daycare._id, name: 'Rainbow Room' });
    await DaycareMember.create({ daycareId: daycare._id, userId: staff._id, role: 'daycare_employee' });

    const activeAssignment = await DaycareChildAssignment.findOne({ childId: child._id, daycareId: classroom.daycareId, status: 'active' });
    expect(activeAssignment).toBeNull();
  });
});
