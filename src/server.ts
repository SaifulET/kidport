import { createServer } from 'http';
import app from './app';
import { connectDatabase } from './config/db';
import { env } from './config/env';
import { initializeSocket } from './socket';

export const start = async () => {
  await connectDatabase();
  const server = createServer(app);
  initializeSocket(server);
  server.listen(env.PORT, () => {
      });
};

if (require.main === module) {
  start().catch((error) => {
        process.exit(1);
  });
}

export default app;
