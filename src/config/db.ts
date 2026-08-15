import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from './env';

let memoryServer: MongoMemoryServer | undefined;

export const connectDatabase = async () => {
  mongoose.set('strictQuery', true);

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
    console.log(`Connected to in-memory MongoDB at ${uri}`);
    return;
  }

  try {
    await mongoose.connect(env.MONGODB_URI);
  } catch (error) {
    throw new Error(
      `Could not connect to MongoDB at ${env.MONGODB_URI}. ` +
        'Start MongoDB locally, update MONGODB_URI, or run `npm run dev` for an in-memory dev database.',
      { cause: error }
    );
  }
};

export const disconnectDatabase = async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
  memoryServer = undefined;
};
