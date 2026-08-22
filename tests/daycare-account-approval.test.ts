import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

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
  });
});
