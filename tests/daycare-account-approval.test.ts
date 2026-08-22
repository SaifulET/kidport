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

    await request(app)
      .post(`/api/v1/auth/admin/daycare-accounts/${daycareRegistration.body.data.user._id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .post('/api/v1/daycares')
      .set('Authorization', `Bearer ${daycareToken}`)
      .send({ name: 'Sunflower Learning Center' })
      .expect(201);
  });
});
