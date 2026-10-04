import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { VillageError, SESSION_MS } from './village.mjs';
import { createRobots, demoRobots, demoEvents, normalizeEvent, applyEvent, publicRobot } from './events.mjs';

const cookieName = 'agent_village_session';
const cookieToken = req => /(?:^|;\s*)agent_village_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
const bearerToken = req => /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
const demoMembers = [
  { id: 'demo-you', displayName: 'Você (demo)', deskSize: 'large', online: true },
  { id: 'demo-renatin', displayName: 'Renatin', deskSize: 'medium', online: true },
  { id: 'demo-julin', displayName: 'Julin', deskSize: 'medium', online: false },
];
function demo(step) {
  const robots = createRobots(demoRobots.map(r => ({ ...r, ownerId: r.member === 'Jrs' ? 'demo-you' : r.member === 'Renatin' ? 'demo-renatin' : 'demo-julin', simulated: true })));
  for (const sample of demoEvents.slice(0, step)) {
    const robot = applyEvent(robots, normalizeEvent(sample.provider, sample.event));
    if (robot) robot.lastSignalAt = sample.at;
  }
  return { simulated: true, serverNow: Date.now(), members: demoMembers, robots: robots.map(publicRobot), step, totalSteps: demoEvents.length };
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new VillageError(400, 'Envie JSON.');
  let length = 0, chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 32768) throw new VillageError(413, 'O envio excedeu 32 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new VillageError(400, 'JSON inválido.'); }
}

export function createVillageServer(village, { publicOrigin, dist }) {
  const configuredOrigin = new URL(publicOrigin).origin;
  const secure = configuredOrigin.startsWith('https:');
  const staticRoot = resolve(dist);
  const limits = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, configuredOrigin), path = url.pathname, method = req.method;
      if (method === 'GET' && path === '/healthz') return json(200, { ok: true, service: 'agent-village' });
      if (path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (method !== 'GET' && req.headers.origin && req.headers.origin !== configuredOrigin) throw new VillageError(403, 'Origem não autorizada.');
        if (method === 'GET' && path === '/api/demo') {
          const step = Number(url.searchParams.get('step') ?? 0);
          if (!Number.isInteger(step) || step < 0 || step > demoEvents.length) throw new VillageError(400, 'Etapa inválida.');
          return json(200, demo(step));
        }
        if (method === 'POST' && ['/api/auth/login', '/api/auth/register'].includes(path)) {
          const now = Date.now(), ip = req.socket.remoteAddress;
          for (const [key, record] of limits) if (record.resetAt <= now) limits.delete(key);
          const record = limits.get(ip) ?? { count: 0, resetAt: now + 600000 };
          limits.set(ip, record);
          if (++record.count > 20) throw new VillageError(429, 'Muitas tentativas. Aguarde 10 minutos.');
          const input = await body(req);
          const session = await (path.endsWith('/register') ? village.register(input) : village.login(input));
          res.setHeader('Set-Cookie', `${cookieName}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
          return json(path.endsWith('/register') ? 201 : 200, { account: session.account });
        }
        if (method === 'POST' && path === '/api/events') return json(200, await village.ingest(bearerToken(req), await body(req)));
        if (!['/api/me', '/api/village', '/api/desk', '/api/robots', '/api/auth/logout'].includes(path) && !/^\/api\/robots\/[^/]+(?:\/token)?$/.test(path)) throw new VillageError(404, 'Destino não encontrado.');
        const owner = village.authenticate(cookieToken(req));
        if (method === 'GET' && path === '/api/me') return json(200, village.me(owner.id));
        if (method === 'GET' && path === '/api/village') return json(200, village.snapshot(owner.id));
        if (method === 'POST' && path === '/api/auth/logout') {
          await village.logout(cookieToken(req));
          res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
          return json(200, { ok: true });
        }
        if (method === 'PATCH' && path === '/api/desk') return json(200, await village.updateDesk(owner.id, await body(req)));
        if (method === 'POST' && path === '/api/robots') return json(201, await village.createRobot(owner.id, await body(req)));
        const match = /^\/api\/robots\/([^/]+)(\/token)?$/.exec(path);
        if (match && method === 'PATCH' && !match[2]) return json(200, await village.updateRobot(owner.id, match[1], await body(req)));
        if (match && method === 'DELETE' && !match[2]) { await village.deleteRobot(owner.id, match[1]); return json(200, { ok: true }); }
        if (match && method === 'POST' && match[2]) return json(200, await village.rotateToken(owner.id, match[1]));
        throw new VillageError(404, 'Destino não encontrado.');
      }
      if (method !== 'GET' && method !== 'HEAD') throw new VillageError(404, 'Destino não encontrado.');
      const candidate = resolve(staticRoot, `.${decodeURIComponent(path)}`);
      if (candidate !== staticRoot && !candidate.startsWith(staticRoot + sep)) throw new VillageError(404, 'Destino não encontrado.');
      const file = path === '/' ? resolve(staticRoot, 'index.html') : candidate;
      let content;
      try { content = await readFile(file); } catch { throw new VillageError(404, 'Arquivo não encontrado.'); }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      json(error instanceof VillageError ? error.status : 500, { error: error instanceof VillageError ? error.message : 'Não foi possível atender. Tente novamente.' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
