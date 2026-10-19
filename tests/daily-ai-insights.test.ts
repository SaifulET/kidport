import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { CareCircleMembership } from '../src/modules/care-circle/care-circle-membership.model';
import { Child } from '../src/modules/children/child.model';
import { DailyAiInsight } from '../src/modules/ai/daily-ai-insight.model';
import { DevelopmentDomain } from '../src/modules/domains/development-domain.model';
import { Observation } from '../src/modules/observations/observation.model';
import { User } from '../src/modules/users/user.model';
import { AIAnalysisService } from '../src/services/AIAnalysisService';
import { DailyAiInsightService } from '../src/services/DailyAiInsightService';
import { TokenService } from '../src/services/TokenService';

let mongo: MongoMemoryServer;
const app = createApp();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  vi.restoreAllMocks();
  vi.spyOn(AIAnalysisService, 'generateDomainProgressKeywords').mockImplementation(async (domains) =>
    domains.map((domain) => ({ domainId: domain.domainId, keyword: AIAnalysisService.fallbackDomainProgressKeyword(domain) }))
  );
  vi.spyOn(AIAnalysisService, 'generateObservationStatusSummary').mockImplementation(async (input) => input.fallback);
  vi.spyOn(AIAnalysisService, 'generateDailyInsight').mockResolvedValue({
    insight: {
      title: 'Language progress is improving',
      summary: 'Recent observations show steady communication and participation.',
      suggestion: 'Try asking open-ended questions during play today.',
      parentTips: [
        'Try asking open-ended questions during play today.',
        'Name objects during a daily routine.',
        'Write down one new word you hear.'
      ],
      domainHighlights: [{ domain: 'Language & Literacy', status: 'steady', keyword: 'improving' }],
      disclaimer: AIAnalysisService.dailyInsightDisclaimer
    },
    status: 'generated'
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const createChildContext = async () => {
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
  await Observation.create({
    childId: child._id,
    authorId: parent._id,
    authorRelationship: 'caregiver',
    type: 'text',
    text: 'Named colors during story time.',
    title: 'Named colors',
    domainId: domain._id,
    stage: 'steady',
    stageScore: 3,
    status: 'active'
  });
  return { parent, child };
};

describe('DailyAiInsightService', () => {
  it('stores one insight per child and local date', async () => {
    const { parent, child } = await createChildContext();
    const first = await DailyAiInsightService.getTodayInsight(child._id.toString(), new Date('2026-10-14T18:30:00.000Z'));
    const second = await DailyAiInsightService.getTodayInsight(child._id.toString(), new Date('2026-10-14T20:00:00.000Z'));

    expect(first.localDate).toBe('2026-10-14');
    expect(second.localDate).toBe('2026-10-14');
    expect(await DailyAiInsight.countDocuments()).toBe(1);
    expect(AIAnalysisService.generateDailyInsight).toHaveBeenCalledTimes(1);
    expect(parent._id).toBeTruthy();
  });

  it('creates a new insight on the next local date', async () => {
    const { child } = await createChildContext();

    await DailyAiInsightService.getTodayInsight(child._id.toString(), new Date('2026-10-14T18:30:00.000Z'));
    await DailyAiInsightService.getTodayInsight(child._id.toString(), new Date('2026-10-15T18:30:00.000Z'));

    expect(await DailyAiInsight.countDocuments()).toBe(2);
    expect(AIAnalysisService.generateDailyInsight).toHaveBeenCalledTimes(2);
  });

  it('always generates parent tips in the fallback insight', () => {
    const fallback = AIAnalysisService.fallbackDailyInsight({
      child: { ageMonths: 24 },
      domainProgress: [{ name: 'Language & Literacy', percentage: 75, stage: 'steady', keyword: 'improving', observationCount: 3 }],
      observationSummary: { achieved: 1, inProgress: 1, upcoming: 1 },
      recentObservations: []
    });

    expect(fallback.parentTips.length).toBeGreaterThan(0);
    expect(fallback.suggestion).toBeTruthy();
  });
});

describe('development progress response', () => {
  it('includes the same stored daily AI insight for every user with child access', async () => {
    const { parent, child } = await createChildContext();
    const caregiver = await User.create({
      fullName: 'Second Parent',
      email: 'second@example.com',
      passwordHash: 'hash',
      userType: 'caregiver',
      caregiverRole: 'parent',
      status: 'active'
    });
    await CareCircleMembership.create({
      childId: child._id,
      userId: caregiver._id,
      role: 'parent',
      relationship: 'parent',
      invitedBy: parent._id,
      status: 'active'
    });

    const parentResponse = await request(app)
      .get(`/api/v1/children/${child._id}/development-progress`)
      .set('Authorization', `Bearer ${TokenService.signAccessToken(parent._id)}`)
      .expect(200);
    const caregiverResponse = await request(app)
      .get(`/api/v1/children/${child._id}/development-progress`)
      .set('Authorization', `Bearer ${TokenService.signAccessToken(caregiver._id)}`)
      .expect(200);

    expect(parentResponse.body.data.todayInsight).toMatchObject({
      title: 'Language progress is improving',
      suggestion: 'Try asking open-ended questions during play today.',
      parentTips: [
        'Try asking open-ended questions during play today.',
        'Name objects during a daily routine.',
        'Write down one new word you hear.'
      ],
      disclaimer: AIAnalysisService.dailyInsightDisclaimer
    });
    expect(caregiverResponse.body.data.todayInsight).toEqual(parentResponse.body.data.todayInsight);
    expect(await DailyAiInsight.countDocuments()).toBe(1);
    expect(parentResponse.body.data.domains[0]).toMatchObject({
      name: 'Language & Literacy',
      stage: 'steady',
      keyword: 'improving'
    });
  });
});
