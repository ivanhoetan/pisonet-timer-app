import http from 'http';
import path from 'path';
import fs from 'fs';
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
import { statsRouter } from './routes/stats';
import { auditRouter } from './routes/audit';

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
  app.use('/stats', statsRouter);
  app.use('/audit', auditRouter);

  // Serve the admin web app (built SPA) at /admin, if present.
  const adminDist = path.resolve(__dirname, '../../admin-web/dist');
  if (fs.existsSync(adminDist)) {
    app.use('/admin', express.static(adminDist));
    app.get('/admin/*', (_req, res) => {
      res.sendFile(path.join(adminDist, 'index.html'));
    });
    console.log('Serving admin web app at /admin');
  }

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
