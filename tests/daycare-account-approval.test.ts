import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { User } from '../src/modules/users/user.model';
import { Child } from '../src/modules/children/child.model';
import { DaycareChildAssignment } from '../src/modules/daycare/daycare-child-assignment.model';
import { Observation } from '../src/modules/observations/observation.model';

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
    await DaycareChildAssignment.create({
      childId: child._id,
      daycareId: approval.body.data.daycare._id,
      assignedBy: parent._id,
      status: 'active'
    });
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
});
