export const DEVELOPMENT_STAGE_SCORE = {
  emerging: 1,
  building: 2,
  steady: 3,
  confident: 4
} as const;

export type DevelopmentStage = keyof typeof DEVELOPMENT_STAGE_SCORE;

export const STAGE_VALUES = Object.keys(DEVELOPMENT_STAGE_SCORE) as DevelopmentStage[];

export const stageFromPercentage = (percentage: number | null) => {
  if (percentage === null) return 'not_enough_data';
  if (percentage >= 1 && percentage <= 25) return 'emerging';
  if (percentage <= 50) return 'building';
  if (percentage <= 75) return 'steady';
  return 'confident';
};
