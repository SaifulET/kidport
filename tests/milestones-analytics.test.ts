import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Child } from '../src/modules/children/child.model';
import { DevelopmentDomain } from '../src/modules/domains/development-domain.model';
import { Observation } from '../src/modules/observations/observation.model';
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

describe('child milestones response', () => {
  it('includes child observation analytics with the milestone list', async () => {
    const parent = await User.create({
      fullName: 'Jane Parent',
      email: 'jane@example.com',
      passwordHash: 'hash',
      userType: 'caregiver',
      caregiverRole: 'parent',
      status: 'active'
    });
    const child = await Child.create({
      fullName: 'New Child',
      dateOfBirth: new Date('2022-08-27'),
      createdBy: parent._id,
      caregivers: [parent._id],
      status: 'active'
    });
    const domain = await DevelopmentDomain.create({
      name: 'Language & Literacy',
      slug: 'language-literacy'
    });

    await Observation.create([
      {
        childId: child._id,
        authorId: parent._id,
        authorRelationship: 'caregiver',
        type: 'text',
        text: 'Named colors during story time.',
        domainId: domain._id,
        stage: 'steady',
        stageScore: 3,
        isMilestone: false,
        status: 'active'
      },
      {
        childId: child._id,
        authorId: parent._id,
        authorRelationship: 'caregiver',
        type: 'text',
        text: 'Retold the story in order.',
        domainId: domain._id,
        stage: 'confident',
        stageScore: 4,
        isMilestone: true,
        status: 'active'
      }
    ]);

    const response = await request(app)
      .get(`/api/v1/children/${child._id}/milestones`)
      .set('Authorization', `Bearer ${TokenService.signAccessToken(parent._id)}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.analytics).toMatchObject({
      childId: child._id.toString(),
      totalObservations: 2,
      totalMilestones: 1,
      byKeyword: {
        steady: 1,
        confident: 1
      }
    });
    expect(response.body.analytics.byDomain[0]).toMatchObject({
      domainId: domain._id.toString(),
      domain: 'Language & Literacy',
      total: 2,
      milestones: 1
    });
  });
});
