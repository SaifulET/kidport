import { Types } from 'mongoose';
import { DEVELOPMENT_STAGE_SCORE, stageFromPercentage, type DevelopmentStage } from '../constants/stages';
import { DevelopmentDomain } from '../modules/domains/development-domain.model';
import { Observation } from '../modules/observations/observation.model';

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
        }).select('stage stageScore');
        const score = this.calculateDomainScore(observations);
        return {
          domainId: domain._id.toString(),
          name: domain.name,
          percentage: score.percentage,
          stage: score.stage,
          observationCount: score.observationCount
        };
      })
    );

    return { childId, domains: results, lastCalculatedAt: new Date() };
  }
}
