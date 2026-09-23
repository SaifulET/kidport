import dns from 'node:dns';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from './env';

let memoryServer: MongoMemoryServer | undefined;
let connectionPromise: Promise<void> | undefined;

const ensurePerformanceIndexes = async () => {
  if (env.NODE_ENV === 'production') return;

  const db = mongoose.connection.db;
  if (!db) return;

  try {
    await Promise.all([
      db.collection('observations').createIndex({ status: 1, occurredAt: -1 }, { name: 'status_1_occurredAt_-1' }),
      db.collection('observations').createIndex({ status: 1, type: 1, occurredAt: -1 }, { name: 'status_1_type_1_occurredAt_-1' })
    ]);
  } catch (_error) {}
};

const configureMongoDns = () => {
  if (!env.MONGODB_URI.startsWith('mongodb+srv://') || !env.MONGODB_DNS_SERVERS) return;

  const servers = env.MONGODB_DNS_SERVERS.split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (servers.length > 0) {
    dns.setServers(servers);
  }
};

export const connectDatabase = async () => {
  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 1) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    if (env.MONGODB_MEMORY_SERVER) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create({
        instance: {
          ip: '127.0.0.1',
          port: 27017,
          dbName: 'kidport'
        }
      });
      const uri = memoryServer.getUri();
      await mongoose.connect(uri);
      await ensurePerformanceIndexes();
            return;
    }

    try {
      configureMongoDns();
      await mongoose.connect(env.MONGODB_URI);
      await ensurePerformanceIndexes();
    } catch (error) {
      throw new Error(
        'Could not connect to MongoDB. ' +
          'Start MongoDB locally, update MONGODB_URI, or run `npm run dev:memory` for an in-memory dev database.',
        { cause: error }
      );
    }
  })().catch((error) => {
    connectionPromise = undefined;
    throw error;
  });

  return connectionPromise;
};

export const disconnectDatabase = async () => {
  connectionPromise = undefined;
  await mongoose.disconnect();
  await memoryServer?.stop();
  memoryServer = undefined;
};
