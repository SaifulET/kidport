import { describe, expect, it } from 'vitest';
import { stageFromPercentage } from '../src/constants/stages';
import { DevelopmentScoringService } from '../src/services/DevelopmentScoringService';
import { ObservationService } from '../src/services/ObservationService';

describe('DevelopmentScoringService', () => {
  it('calculates domain percentage using observed scored indicators only', () => {
    const result = DevelopmentScoringService.calculateDomainScore([
      { stageScore: 1 },
      { stageScore: 3 },
      { stageScore: 4 },
      { stageScore: 4 }
    ]);

    expect(result).toEqual({ percentage: 75, stage: 'steady', observationCount: 4 });
  });

  it('maps percentage boundaries exactly', () => {
    expect(stageFromPercentage(25)).toBe('emerging');
    expect(stageFromPercentage(26)).toBe('building');
    expect(stageFromPercentage(50)).toBe('building');
    expect(stageFromPercentage(51)).toBe('steady');
    expect(stageFromPercentage(75)).toBe('steady');
    expect(stageFromPercentage(76)).toBe('confident');
    expect(stageFromPercentage(100)).toBe('confident');
  });

  it('does not label no observations as emerging', () => {
    expect(DevelopmentScoringService.calculateDomainScore([])).toEqual({
      percentage: null,
      stage: 'not_enough_data',
      observationCount: 0
    });
  });

  it('derives overall score only from domains with data', () => {
    expect(
      DevelopmentScoringService.calculateOverallScore([
        { percentage: 75 },
        { percentage: 60 },
        { percentage: null },
        { percentage: 85 },
        { percentage: 70 }
      ])
    ).toBe(72.5);
  });
});

describe('Observation milestone rule', () => {
  it('makes confident observations milestones', () => {
    expect(ObservationService.isMilestoneStage('confident')).toBe(true);
  });

  it('does not make non-confident observations milestones', () => {
    expect(ObservationService.isMilestoneStage('steady')).toBe(false);
    expect(ObservationService.isMilestoneStage('building')).toBe(false);
    expect(ObservationService.isMilestoneStage('emerging')).toBe(false);
  });
});
