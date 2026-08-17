export type DevelopmentalAgeDisplay = {
  months: number | null;
  years?: number;
  remainingMonths?: number;
  days?: number;
  label: string;
} | null;

export const developmentalAgeDisplay = (value: unknown): DevelopmentalAgeDisplay => {
  if (!value || typeof value !== 'object') return null;
  const source = value as {
    months?: unknown;
    years?: unknown;
    remainingMonths?: unknown;
    days?: unknown;
    label?: unknown;
  };

  return {
    months: typeof source.months === 'number' ? source.months : null,
    years: typeof source.years === 'number' ? source.years : undefined,
    remainingMonths: typeof source.remainingMonths === 'number' ? source.remainingMonths : undefined,
    days: typeof source.days === 'number' ? source.days : undefined,
    label: typeof source.label === 'string' ? source.label : 'Not enough data'
  };
};
