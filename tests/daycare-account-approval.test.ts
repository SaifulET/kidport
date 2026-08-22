import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { User } from '../src/modules/users/user.model';
import { Child } from '../src/modules/children/child.model';
import { DaycareChildAssignment } from '../src/modules/daycare/daycare-child-assignment.model';
import { Observation } from '../src/modules/observations/observation.model';
import { TokenService } from '../src/services/TokenService';
import { CareCircleMembership } from '../src/modules/care-circle/care-circle-membership.model';
import { Daycare } from '../src/modules/daycare/daycare.model';

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

describe('daycare account approval', () => {
  it('allows daycare registration and login while requiring admin approval for daycare operations', async () => {
    const daycareRegistration = await request(app)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Sunflower Owner',
        email: 'owner@sunflower.example',
        password: 'strongPassword123',
        identity: 'daycare'
      })
      .expect(201);

    expect(daycareRegistration.body.data.user.status).toBe('pending');

    const daycareLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@sunflower.example', password: 'strongPassword123' })
      .expect(200);

    const daycareToken = daycareLogin.body.data.accessToken;
    expect(daycareLogin.body.data.user.status).toBe('pending');

    await request(app)
      .post('/api/v1/daycares')
      .set('Authorization', `Bearer ${daycareToken}`)
      .send({ name: 'Sunflower Learning Center' })
      .expect(403);

    await request(app)
      .post('/api/v1/classroom')
      .set('Authorization', `Bearer ${daycareToken}`)
      .send({ name: 'Toddlers' })
      .expect(403);

    const adminRegistration = await request(app)
      .post('/api/v1/auth/admin/register')
      .send({
        fullName: 'Platform Admin',
        email: 'admin@kidport.example',
        password: 'strongPassword123'
      })
      .expect(201);

    const adminToken = adminRegistration.body.data.accessToken;
    const pendingAccounts = await request(app)
      .get('/api/v1/auth/admin/daycare-accounts?status=pending')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(pendingAccounts.body.data).toHaveLength(1);

    const approval = await request(app)
      .post(`/api/v1/auth/admin/daycare-accounts/${daycareRegistration.body.data.user._id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(approval.body.data.daycare.name).toBe('Sunflower Owner');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);

    expect(me.body.data.daycareId).toBe(approval.body.data.daycare._id);

    await request(app)
      .post('/api/v1/classroom')
      .set('Authorization', `Bearer ${daycareToken}`)
      .send({ name: 'Toddlers', leadTeacher: '66f...' })
      .expect(400);

    const classroom = await request(app)
      .post('/api/v1/classroom')
      .set('Authorization', `Bearer ${daycareToken}`)
      .send({ name: 'Toddlers', capacity: 12 })
      .expect(201);

    expect(classroom.body.data.daycareId).toBe(approval.body.data.daycare._id);

    const classrooms = await request(app)
      .get('/api/v1/classroom')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);

    expect(classrooms.body.data).toHaveLength(1);

    const parent = await User.create({
      fullName: 'Ava Parent',
      email: 'parent@example.com',
      passwordHash: 'hash',
      userType: 'caregiver',
      caregiverRole: 'parent'
    });
    const child = await Child.create({ fullName: 'Ava Child', dateOfBirth: new Date('2022-01-01'), createdBy: parent._id });
    const parentToken = TokenService.signAccessToken(parent._id);

    await request(app)
      .post(`/api/v1/children/${child._id}/daycare-invitations`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ daycareId: approval.body.data.daycare._id })
      .expect(201);

    await request(app)
      .post(`/api/v1/children/${child._id}/daycare-invitations`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ daycareId: approval.body.data.daycare._id })
      .expect(409);

    const daycareInvitations = await request(app)
      .get('/api/v1/daycare/invitations')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);
    expect(daycareInvitations.body.data).toHaveLength(1);

    const unassignedBeforePlacement = await request(app)
      .get('/api/v1/daycare/children/unassigned')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);
    expect(unassignedBeforePlacement.body.data).toHaveLength(1);
    expect(unassignedBeforePlacement.body.data[0].status).toBe('pending');

    await DaycareChildAssignment.deleteOne({ childId: child._id, daycareId: approval.body.data.daycare._id });

    const invitationOnlyUnassigned = await request(app)
      .get('/api/v1/daycare/children/unassigned')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);
    expect(invitationOnlyUnassigned.body.data).toHaveLength(1);
    expect(invitationOnlyUnassigned.body.data[0].source).toBe('invitation');

    await DaycareChildAssignment.updateOne(
      { childId: child._id, daycareId: approval.body.data.daycare._id },
      { $set: { assignedBy: parent._id, status: 'pending' }, $unset: { classroomId: '' } },
      { upsert: true }
    );

    await DaycareChildAssignment.updateOne(
      { childId: child._id, daycareId: approval.body.data.daycare._id },
      { $set: { classroomId: null } }
    );

    const unassignedWithNullClassroom = await request(app)
      .get('/api/v1/daycare/children/unassigned')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);
    expect(unassignedWithNullClassroom.body.data).toHaveLength(1);

    await request(app)
      .post(`/api/v1/classroom/${classroom.body.data._id}/children`)
      .set('Authorization', `Bearer ${daycareToken}`)
      .send({ childIds: [child._id.toString()] })
      .expect(200);

    const unassignedAfterPlacement = await request(app)
      .get('/api/v1/daycare/children/unassigned')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);
    expect(unassignedAfterPlacement.body.data).toHaveLength(0);

    const activeAssignment = await DaycareChildAssignment.findOne({ childId: child._id, daycareId: approval.body.data.daycare._id });
    expect(activeAssignment?.status).toBe('active');

    const daycareInvitationsAfterPlacement = await request(app)
      .get('/api/v1/daycare/invitations')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);
    expect(daycareInvitationsAfterPlacement.body.data).toHaveLength(0);

    await Observation.create({
      childId: child._id,
      authorId: daycareRegistration.body.data.user._id,
      daycareId: approval.body.data.daycare._id,
      type: 'text',
      text: 'Ava stacked blocks.',
      status: 'active'
    });

    const stats = await request(app)
      .get('/api/v1/daycare/stats')
      .set('Authorization', `Bearer ${daycareToken}`)
      .expect(200);

    expect(stats.body.data).toMatchObject({
      daycareId: approval.body.data.daycare._id,
      totalClassrooms: 1,
      totalObservations: 1,
      totalAssociatedChildren: 1
    });
  });

  it('auto-accepts pending care-circle invitations after invited parent registration', async () => {
    const owner = await User.create({
      fullName: 'Owner Parent',
      email: 'owner@example.com',
      passwordHash: 'hash',
      userType: 'caregiver',
      caregiverRole: 'parent'
    });
    const ownerToken = TokenService.signAccessToken(owner._id);
    const child = await Child.create({ fullName: 'Mina Child', dateOfBirth: new Date('2021-01-01'), createdBy: owner._id });

    await request(app)
      .post(`/api/v1/children/${child._id}/care-circle/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'newparent@example.com', role: 'parent' })
      .expect(201);

    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'New Parent',
        email: 'newparent@example.com',
        password: 'strongPassword123',
        identity: 'parent'
      })
      .expect(201);

    expect(registration.body.data.acceptedInvitationCount).toBe(1);
    const membership = await CareCircleMembership.findOne({
      childId: child._id,
      userId: registration.body.data.user._id,
      status: 'active'
    });
    expect(membership?.role).toBe('parent');
  });

  it('does not allow invitations to daycares whose owner account is not approved', async () => {
    const owner = await User.create({
      fullName: 'Owner Parent',
      email: 'owner@example.com',
      passwordHash: 'hash',
      userType: 'caregiver',
      caregiverRole: 'parent'
    });
    const pendingDaycareOwner = await User.create({
      fullName: 'Pending Daycare',
      email: 'pending-daycare@example.com',
      passwordHash: 'hash',
      userType: 'daycare',
      daycareRole: 'daycare_admin',
      status: 'pending'
    });
    const daycare = await Daycare.create({ name: 'Pending Daycare', ownerId: pendingDaycareOwner._id, email: pendingDaycareOwner.email });
    const child = await Child.create({ fullName: 'Mina Child', dateOfBirth: new Date('2021-01-01'), createdBy: owner._id });
    const ownerToken = TokenService.signAccessToken(owner._id);

    const daycares = await request(app)
      .get('/api/v1/daycares')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(daycares.body.data).toHaveLength(0);

    await request(app)
      .post(`/api/v1/children/${child._id}/daycare-invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ daycareId: daycare._id })
      .expect(403);
  });
});
