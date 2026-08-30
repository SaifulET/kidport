import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.errors
    });
  }

  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded file is too large'
        : err.message || 'Invalid file upload';
    return res.status(status).json({
      success: false,
      message,
      errors: [{ code: err.code, field: err.field }]
    });
  }

  const status = err instanceof AppError ? err.statusCode : 500;
  return res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    errors: err instanceof AppError ? err.errors : undefined,
    stack: env.NODE_ENV === 'development' ? err.stack : undefined
  });
};
