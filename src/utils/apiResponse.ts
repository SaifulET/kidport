import type { Response } from 'express';

export const ok = (res: Response, message: string, data: unknown = null, status = 200) =>
  res.status(status).json({ success: true, message, data });

export const paginated = (
  res: Response,
  message: string,
  data: unknown[],
  page: number,
  limit: number,
  total: number
) =>
  res.json({
    success: true,
    message,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
