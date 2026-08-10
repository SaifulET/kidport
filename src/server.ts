import { createApp } from './app';
import { connectDatabase } from './config/db';
import { env } from './config/env';

const start = async () => {
  await connectDatabase();
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Kidport API listening on port ${env.PORT}`);
  });
};

start().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
