import { Types } from 'mongoose';
import { DEVELOPMENT_STAGE_SCORE, stageFromPercentage, type DevelopmentStage } from '../constants/stages';
import { calculateAge } from '../utils/date';
import { Child } from '../modules/children/child.model';
import { AgeBand } from '../modules/domains/age-band.model';
import { DevelopmentDomain } from '../modules/domains/development-domain.model';
import { DevelopmentIndicator } from '../modules/domains/development-indicator.model';
import { Observation } from '../modules/observations/observation.model';
import { AIAnalysisService } from './AIAnalysisService';
import { AppError } from '../utils/AppError';

export type ScoreInput = { stage?: DevelopmentStage | null; stageScore?: number | null };

export class DevelopmentScoringService {
  static scoreForStage(stage: DevelopmentStage) {
    return DEVELOPMENT_STAGE_SCORE[stage];
  }

  static calculateDomainScore(entries: ScoreInput[]) {
    const scored = entries
      .map((entry) => entry.stageScore ?? (entry.stage ? DEVELOPMENT_STAGE_SCORE[entry.stage] : undefined))
      .filter((score): score is number => typeof score === 'number');

    if (scored.length === 0) return { percentage: null, stage: 'not_enough_data', observationCount: 0 };

    const percentage = Math.round((scored.reduce((sum, score) => sum + score, 0) / (4 * scored.length)) * 100);
    return { percentage, stage: stageFromPercentage(percentage), observationCount: scored.length };
  }

  static calculateOverallScore(domainScores: { percentage: number | null }[]) {
    const valid = domainScores
      .map((item) => item.percentage)
      .filter((percentage): percentage is number => typeof percentage === 'number');
    if (valid.length === 0) return null;
    return Math.round((valid.reduce((sum, percentage) => sum + percentage, 0) / valid.length) * 10) / 10;
  }

  static async calculateChildProgress(childId: string, query: { startDate?: Date; endDate?: Date } = {}) {
    const domains = await DevelopmentDomain.find({ status: 'active' }).sort({ sortOrder: 1, name: 1 });
    const dateFilter: Record<string, Date> = {};
    if (query.startDate) dateFilter.$gte = query.startDate;
    if (query.endDate) dateFilter.$lte = query.endDate;

    const results = await Promise.all(
      domains.map(async (domain) => {
        const observations = await Observation.find({
          childId: new Types.ObjectId(childId),
          domainId: domain._id,
          status: 'active',
          ...(Object.keys(dateFilter).length ? { occurredAt: dateFilter } : {})
        })
          .select('stage stageScore text title occurredAt')
          .sort({ occurredAt: 1 });
        const score = this.calculateDomainScore(observations);
        return {
          domainId: domain._id.toString(),
          name: domain.name,
          percentage: score.percentage,
          stage: score.stage,
          observationCount: score.observationCount,
          observations
        };
      })
    );

    const keywords = await AIAnalysisService.generateDomainProgressKeywords(
      results.map((result) => ({
        domainId: result.domainId,
        name: result.name,
        percentage: result.percentage,
        observationCount: result.observationCount,
        observations: result.observations
      }))
    );
    const keywordByDomain = new Map(keywords.map((item) => [item.domainId, item.keyword]));
    const responseDomains = results.map(({ observations: _observations, ...result }) => ({
      ...result,
      keyword: keywordByDomain.get(result.domainId) ?? 'not-enough-data'
    }));

    return { childId, domains: responseDomains, lastCalculatedAt: new Date() };
  }

  static async calculateObservationSummary(childId: string) {
    const child = await Child.findById(childId).select('dateOfBirth');
    if (!child) throw new AppError('Child not found', 404);

    const ageMonths = calculateAge(child.dateOfBirth).totalMonths;
    const ageBand = await AgeBand.findOne({
      status: 'active',
      minMonths: { $lte: ageMonths },
      maxMonths: { $gte: ageMonths }
    }).sort({ minMonths: -1 });

    const [domains, indicators, observations] = await Promise.all([
      DevelopmentDomain.find({ status: 'active' }).select('name'),
      ageBand ? DevelopmentIndicator.find({ ageBandId: ageBand._id, status: 'active' }).select('title domainId') : [],
      Observation.find({ childId: new Types.ObjectId(childId), status: 'active' })
        .select('domainId indicatorId stage stageScore text title isMilestone occurredAt')
        .sort({ occurredAt: -1 })
    ]);

    const domainNameById = new Map(domains.map((domain) => [domain._id.toString(), domain.name]));
    const useIndicators = indicators.length > 0;
    const items = useIndicators
      ? indicators.map((indicator) => ({
          key: indicator._id.toString(),
          name: indicator.title,
          domain: domainNameById.get(indicator.domainId.toString())
        }))
      : domains.map((domain) => ({
          key: domain._id.toString(),
          name: domain.name,
          domain: domain.name
        }));

    const latestByKey = new Map<string, (typeof observations)[number]>();
    for (const observation of observations) {
      const key = useIndicators ? observation.indicatorId?.toString() : observation.domainId?.toString();
      if (key && !latestByKey.has(key)) latestByKey.set(key, observation);
    }

    const summaryItems = items.map((item) => {
      const latest = latestByKey.get(item.key);
      return {
        name: item.name,
        domain: item.domain,
        latestStage: latest?.stage ?? null,
        latestText: latest?.text ?? null,
        latestTitle: latest?.title ?? null,
        observed: Boolean(latest)
      };
    });

    const fallback = summaryItems.reduce(
      (counts, item) => {
        if (!item.observed) counts.upcoming += 1;
        else if (item.latestStage === 'confident') counts.achieved += 1;
        else counts.inProgress += 1;
        return counts;
      },
      { achieved: 0, inProgress: 0, upcoming: 0 }
    );

    const summary = await AIAnalysisService.generateObservationStatusSummary({ fallback, items: summaryItems });
    return { childId, ...summary, lastCalculatedAt: new Date() };
  }
}
