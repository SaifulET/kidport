import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import type { NextFunction, Request, Response } from 'express';
import { connectDatabase } from './config/db';
import { env } from './config/env';
import { v1Router } from './routes/v1';
import { errorHandler, notFound } from './middlewares/errorHandler';

type ObservationTraceEvent = { label: string; ms: number; detail?: Record<string, unknown> };

const observationTraceNow = () => process.hrtime.bigint();

const observationTraceMs = (startedAt: bigint) => Number(process.hrtime.bigint() - startedAt) / 1_000_000;

const observationTraceMark = (req: Request, label: string, detail?: Record<string, unknown>) => {
  const trace = (req as Request & { observationTrace?: { startedAt: bigint; events: ObservationTraceEvent[] } }).observationTrace;
  if (!trace) return;
  trace.events.push({ label, ms: observationTraceMs(trace.startedAt), detail });
};

const observationLifecycleTrace = (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' || req.path !== '/api/v1/admin/observations') {
    next();
    return;
  }

  const startedAt = observationTraceNow();
  (req as Request & { observationTrace?: { startedAt: bigint; events: ObservationTraceEvent[] } }).observationTrace = {
    startedAt,
    events: [{ label: 'T1 backend request received', ms: 0 }]
  };

  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    observationTraceMark(req, 'response.json entered', {
      bodyType: typeof body,
      rows: Array.isArray((body as { data?: unknown })?.data) ? ((body as { data: unknown[] }).data.length) : undefined
    });
    const jsonStartedAt = observationTraceNow();
    const result = originalJson(body);
    observationTraceMark(req, 'response.json returned', {
      durationMs: Number(process.hrtime.bigint() - jsonStartedAt) / 1_000_000,
      statusCode: res.statusCode
    });
    return result;
  }) as typeof res.json;

  const originalSend = res.send.bind(res);
  res.send = ((body?: unknown) => {
    observationTraceMark(req, 'response.send entered', {
      bodyType: typeof body,
      bodyBytes:
        typeof body === 'string'
          ? Buffer.byteLength(body)
          : Buffer.isBuffer(body)
            ? body.length
            : undefined
    });
    const sendStartedAt = observationTraceNow();
    const result = originalSend(body);
    observationTraceMark(req, 'response.send returned', {
      durationMs: Number(process.hrtime.bigint() - sendStartedAt) / 1_000_000,
      statusCode: res.statusCode
    });
    return result;
  }) as typeof res.send;

  res.once('finish', () => {
    observationTraceMark(req, 'T7 response finish', {
      statusCode: res.statusCode,
      contentLength: res.getHeader('content-length'),
      contentEncoding: res.getHeader('content-encoding'),
      etag: res.getHeader('etag'),
      cacheControl: res.getHeader('cache-control')
    });
  });

  res.once('close', () => {
    observationTraceMark(req, 'T8 response close', {
      statusCode: res.statusCode,
      writableEnded: res.writableEnded,
      destroyed: res.destroyed
    });
    const trace = (req as Request & { observationTrace?: { events: ObservationTraceEvent[] } }).observationTrace;
    if (trace) {
      console.log('[ObservationLifecycle]', JSON.stringify(trace.events));
    }
  });

  next();
};

const ensureDatabase = async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    observationTraceMark(_req, 'api/v1 ensureDatabase started');
    await connectDatabase();
    observationTraceMark(_req, 'api/v1 ensureDatabase completed');
    next();
  } catch (error) {
    next(error);
  }
};

const disableApiCaching = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export const createApp = () => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(mongoSanitize());
  app.use(observationLifecycleTrace);
  app.use((req, _res, next) => {
    observationTraceMark(req, 'global middleware before rateLimit');
    next();
  });
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: env.NODE_ENV === 'test' ? 10000 : 300,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use((req, _res, next) => {
    observationTraceMark(req, 'global middleware after rateLimit');
    next();
  });
  if (env.NODE_ENV !== 'test') app.use(morgan('combined'));
  app.use((req, _res, next) => {
    observationTraceMark(req, 'global middleware after morgan');
    next();
  });

  app.get('/', (_req, res) => res.redirect(302, '/api/v1/health'));
  app.get(['/favicon.ico', '/favicon.png'], (_req, res) => res.status(204).end());
  app.use('/api/v1', disableApiCaching, ensureDatabase, v1Router);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

const app = createApp();

export default app;
