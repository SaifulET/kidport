import mongoose from 'mongoose';
import { env } from './env';

export const connectDatabase = async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI);
};
