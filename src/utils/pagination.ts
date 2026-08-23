import type { ParsedQs } from 'qs';
import { z } from 'zod';
import { AppError } from './AppError';

export const paginationQuerySchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
};

type QueryValue = string | number | ParsedQs | string[] | ParsedQs[] | undefined;

const firstValue = (value: QueryValue) => (Array.isArray(value) ? value[0] : value);

const numericQueryValue = (value: QueryValue, fallback: number, field: string) => {
  const raw = firstValue(value);
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new AppError(`${field} must be a number`, 400);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new AppError(`${field} must be a positive integer`, 400);
  return parsed;
};

export const paginationFromQuery = (query: { page?: QueryValue; limit?: QueryValue }) => {
  const page = numericQueryValue(query.page, 1, 'page');
  const limit = numericQueryValue(query.limit, 20, 'limit');
  if (limit > 100) throw new AppError('limit must be less than or equal to 100', 400);
  return { page, limit, skip: (page - 1) * limit };
};

export const paginateArray = <T>(items: T[], page: number, limit: number) =>
  items.slice((page - 1) * limit, page * limit);
