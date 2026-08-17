import { Types } from 'mongoose';
import { env } from '../config/env';
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

  static async calculateChildProgress(
    childId: string,
    query: { startDate?: Date; endDate?: Date } = {},
    options: { useAIKeywords?: boolean } = {}
  ) {
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

    const keywordInputs = results.map((result) => ({
      domainId: result.domainId,
      name: result.name,
      percentage: result.percentage,
      observationCount: result.observationCount,
      observations: result.observations
    }));
    const keywords =
      options.useAIKeywords === false
        ? keywordInputs.map((domain) => ({
            domainId: domain.domainId,
            keyword: AIAnalysisService.fallbackDomainProgressKeyword(domain)
          }))
        : await AIAnalysisService.generateDomainProgressKeywords(keywordInputs);
    const keywordByDomain = new Map(keywords.map((item) => [item.domainId, item.keyword]));
    const responseDomains = results.map(({ observations: _observations, ...result }) => ({
      ...result,
      keyword: keywordByDomain.get(result.domainId) ?? 'not-enough-data'
    }));

    return { childId, domains: responseDomains, lastCalculatedAt: new Date() };
  }

  static async calculateDevelopmentalAge(
    childId: string,
    domains?: Array<{
      domainId: string;
      name: string;
      percentage: number | null;
      stage: string;
      observationCount: number;
      keyword: string;
    }>
  ) {
    const child = await Child.findById(childId).select('dateOfBirth');
    if (!child) throw new AppError('Child not found', 404);

    const progress = domains ?? (await this.calculateChildProgress(childId)).domains;
    const [ageBands, indicators, observations] = await Promise.all([
      AgeBand.find({ status: 'active' }).sort({ minMonths: 1 }),
      DevelopmentIndicator.find({ status: 'active' }).select('domainId ageBandId title'),
      Observation.find({ childId: new Types.ObjectId(childId), status: 'active' })
        .select('domainId indicatorId stage stageScore text title occurredAt')
        .sort({ occurredAt: -1 })
        .limit(100)
    ]);

    const indicatorById = new Map(indicators.map((indicator) => [indicator._id.toString(), indicator]));
    const latestByIndicator = new Map<string, (typeof observations)[number]>();
    for (const observation of observations) {
      const indicatorId = observation.indicatorId?.toString();
      if (indicatorId && !latestByIndicator.has(indicatorId)) latestByIndicator.set(indicatorId, observation);
    }

    const ageBandEvidence = ageBands.map((band) => {
      const bandIndicators = indicators.filter((indicator) => indicator.ageBandId.toString() === band._id.toString());
      const scores = bandIndicators
        .map((indicator) => latestByIndicator.get(indicator._id.toString()))
        .map((observation) => observation?.stageScore ?? (observation?.stage ? DEVELOPMENT_STAGE_SCORE[observation.stage] : undefined))
        .filter((score): score is number => typeof score === 'number');
      return {
        id: band._id.toString(),
        label: band.label,
        minMonths: band.minMonths,
        maxMonths: band.maxMonths,
        indicatorCount: bandIndicators.length,
        observedCount: scores.length,
        averageStageScore: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null,
        confidentCount: scores.filter((score) => score >= DEVELOPMENT_STAGE_SCORE.confident).length
      };
    });

    const domainNameById = new Map(progress.map((domain) => [domain.domainId, domain.name]));
    const recentObservations = observations.slice(0, 30).map((observation) => {
      const indicator = observation.indicatorId ? indicatorById.get(observation.indicatorId.toString()) : undefined;
      const domainId = observation.domainId?.toString() ?? indicator?.domainId.toString();
      return {
        domain: domainId ? domainNameById.get(domainId) : undefined,
        stage: observation.stage,
        stageScore: observation.stageScore,
        title: observation.title,
        text: observation.text,
        occurredAt: observation.occurredAt
      };
    });

    return AIAnalysisService.generateDevelopmentalAgeEstimate({
      chronologicalAgeMonths: calculateAge(child.dateOfBirth).totalMonths,
      domains: progress,
      ageBands: ageBandEvidence,
      recentObservations
    });
  }

  static async refreshChildDevelopmentSnapshot(childId: string) {
    const progress = await this.calculateChildProgress(childId);
    const developmentalAge = await this.calculateDevelopmentalAge(childId, progress.domains);
    const lastCalculatedAt = new Date();
    const overallScore = this.calculateOverallScore(progress.domains);
    const domainProgress = progress.domains.map((domain) => ({
      domainId: new Types.ObjectId(domain.domainId),
      name: domain.name,
      percentage: domain.percentage,
      stage: domain.stage,
      observationCount: domain.observationCount,
      keyword: domain.keyword
    }));

    await Child.findByIdAndUpdate(childId, {
      $set: {
        developmentProgress: domainProgress,
        developmentOverallScore: overallScore,
        developmentalAge: {
          ...developmentalAge,
          calculatedAt: lastCalculatedAt,
          model: env.OPENAI_MODEL
        },
        developmentLastCalculatedAt: lastCalculatedAt
      }
    });

    return {
      childId,
      domains: progress.domains,
      overallScore,
      developmentalAge,
      lastCalculatedAt
    };
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
