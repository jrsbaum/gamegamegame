import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '../shared/protocol';
import { createCaracolManager } from './caracol/game';
import { isOriginAllowed, parseAllowedOrigins } from './origins';

const app = express();
const httpServer = createServer(app);
const allowedOrigins = parseAllowedOrigins(process.env.PUBLIC_ORIGIN);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
});
const caracolManager = createCaracolManager(io);

app.disable('x-powered-by');
app.get('/healthz', (request, response) => {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && isOriginAllowed(allowedOrigins, origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.json({ ok: true, service: 'caracol', rooms: 0, caracolOnline: caracolManager.getOnlineCount() });
});

const clientDist = path.resolve(process.cwd(), 'dist');
if (existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/socket.io')) {
      next();
      return;
    }
    response.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_request, response) => response.json({ service: 'caracol', mode: 'api-only', healthz: '/healthz' }));
}

io.on('connection', (socket) => caracolManager.bindSocket(socket));

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';

const shutdown = (): void => {
  caracolManager.dispose();
  io.close();
  httpServer.close(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

void caracolManager.ready().then(() => {
  httpServer.listen(port, host, () => console.log(`[caracol] ouvindo em http://${host}:${port}`));
}).catch((error: unknown) => {
  console.error('[caracol] não foi possível inicializar o mundo persistente', error);
  process.exitCode = 1;
});
