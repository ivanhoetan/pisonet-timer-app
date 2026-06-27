import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { connectDb } from './db';
import { setupWebSocket } from './websocket';
import { sessionEngine } from './services/sessionEngine';
import { Session } from './models/Session';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { computersRouter } from './routes/computers';
import { sessionsRouter } from './routes/sessions';
import { transactionsRouter } from './routes/transactions';

async function main(): Promise<void> {
  await connectDb();
  await Session.init();
  await sessionEngine.rehydrate();

  const app = express();
  const server = http.createServer(app);

  setupWebSocket(server);

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/computers', computersRouter);
  app.use('/sessions', sessionsRouter);
  app.use('/transactions', transactionsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  server.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
