import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import { env } from './config/env';
import { v1Router } from './routes/v1';
import { errorHandler, notFound } from './middlewares/errorHandler';

export const createApp = () => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(mongoSanitize());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: env.NODE_ENV === 'test' ? 10000 : 300,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  if (env.NODE_ENV !== 'test') app.use(morgan('combined'));

  app.use('/api/v1', v1Router);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
