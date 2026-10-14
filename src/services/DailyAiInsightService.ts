import { Types } from 'mongoose';
import { env } from '../config/env';
import { calculateAge } from '../utils/date';
import { DailyAiInsight } from '../modules/ai/daily-ai-insight.model';
import { Child } from '../modules/children/child.model';
import { DevelopmentDomain } from '../modules/domains/development-domain.model';
import { Observation } from '../modules/observations/observation.model';
import { AIAnalysisService } from './AIAnalysisService';
import { DevelopmentScoringService } from './DevelopmentScoringService';
import { AppError } from '../utils/AppError';

export class DailyAiInsightService {
  static localDateForTimezone(date: Date, timezone = 'UTC') {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.normalizeTimezone(timezone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  static normalizeTimezone(timezone?: string | null) {
    if (!timezone) return 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
      return timezone;
    } catch (_error) {
      return 'UTC';
    }
  }

  private static response(insight: {
    title: string;
    summary: string;
    suggestion: string;
    domainHighlights?: Array<{ domain: string; status: string; keyword: string }>;
    disclaimer: string;
    generatedAt: Date;
    localDate: string;
    status?: string;
  }) {
    return {
      title: insight.title,
      summary: insight.summary,
      suggestion: insight.suggestion,
      domainHighlights: insight.domainHighlights ?? [],
      generatedAt: insight.generatedAt,
      localDate: insight.localDate,
      disclaimer: insight.disclaimer,
      status: insight.status
    };
  }

  static async getTodayInsight(childId: string, now = new Date()) {
    const localDate = this.localDateForTimezone(now);
    const existing = await DailyAiInsight.findOne({ childId, localDate });
    if (existing) return this.response(existing);

    return this.response(await this.generateForChild(childId, localDate, now));
  }

  static async generateForChild(childId: string, localDate?: string, now = new Date()) {
    if (!Types.ObjectId.isValid(childId)) {
      throw new AppError('Invalid child id', 400);
    }

    const child = await Child.findOne({ _id: childId, status: { $ne: 'deleted' } }).select('dateOfBirth');
    if (!child) throw new AppError('Child not found', 404);

    const resolvedLocalDate = localDate ?? this.localDateForTimezone(now);
    const existing = await DailyAiInsight.findOne({ childId, localDate: resolvedLocalDate });
    if (existing) return existing;

    const [progress, observationSummary, recentObservations, domains] = await Promise.all([
      DevelopmentScoringService.calculateChildProgress(childId),
      DevelopmentScoringService.calculateObservationSummary(childId),
      Observation.find({
        childId: new Types.ObjectId(childId),
        status: 'active',
        'aiMetadata.observationProcessing.status': { $nin: ['queued', 'processing'] }
      })
        .select('domainId title text stage occurredAt')
        .sort({ occurredAt: -1 })
        .limit(12),
      DevelopmentDomain.find({ status: 'active' }).select('name')
    ]);

    const domainNameById = new Map(domains.map((domain) => [domain._id.toString(), domain.name]));
    const result = await AIAnalysisService.generateDailyInsight({
      child: {
        ageMonths: calculateAge(child.dateOfBirth, now).totalMonths
      },
      domainProgress: progress.domains.map((domain) => ({
        name: domain.name,
        percentage: domain.percentage,
        stage: domain.stage,
        keyword: domain.keyword,
        observationCount: domain.observationCount
      })),
      observationSummary: {
        achieved: observationSummary.achieved,
        inProgress: observationSummary.inProgress,
        upcoming: observationSummary.upcoming
      },
      recentObservations: recentObservations.map((observation) => ({
        domain: observation.domainId ? domainNameById.get(observation.domainId.toString()) ?? null : null,
        title: observation.title,
        text: observation.text,
        stage: observation.stage,
        occurredAt: observation.occurredAt
      }))
    });

    const update = {
      childId: new Types.ObjectId(childId),
      localDate: resolvedLocalDate,
      title: result.insight.title,
      summary: result.insight.summary,
      suggestion: result.insight.suggestion,
      domainHighlights: result.insight.domainHighlights,
      disclaimer: result.insight.disclaimer,
      generatedAt: now,
      model: env.OPENAI_MODEL,
      status: result.status
    };

    return DailyAiInsight.findOneAndUpdate(
      { childId, localDate: resolvedLocalDate },
      { $setOnInsert: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  static async findEligibleChildren() {
    return Child.find({ status: 'active' }).select('_id');
  }

  static async refreshDueInsights(options: { now?: Date; limit?: number } = {}) {
    const now = options.now ?? new Date();
    const limit = options.limit ?? 25;
    const children = await this.findEligibleChildren();
    const localDate = this.localDateForTimezone(now);
    let refreshed = 0;

    for (const child of children) {
      if (refreshed >= limit) break;
      const childId = child._id.toString();
      const exists = await DailyAiInsight.exists({ childId, localDate });
      if (exists) continue;
      await this.generateForChild(childId, localDate, now);
      refreshed += 1;
    }

    return { checked: children.length, refreshed };
  }
}
