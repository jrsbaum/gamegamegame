import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRobots, normalizeEvent, applyEvent, publicRobot } from './events.mjs';

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
const token = () => randomBytes(32).toString('hex');
const safeEqual = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const publicAccount = a => ({ id: a.id, username: a.username, displayName: a.displayName, deskSize: a.deskSize });

export class VillageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const invalid = () => { throw new VillageError(400, 'Dados inválidos. Confira os campos e limites.'); };
function text(value, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}
function shape(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) invalid();
}
const ownerRobot = (state, ownerId, id) => {
  const robot = state.robots.find(r => r.id === id && r.ownerId === ownerId);
  if (!robot) throw new VillageError(404, 'Robô não encontrado.');
  return robot;
};

export class JsonStore {
  constructor(file, state, beforePersist) { this.file = file; this.state = state; this.beforePersist = beforePersist; this.queue = Promise.resolve(); }
  static async open(file, { beforePersist } = {}) {
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.accounts) || !Array.isArray(state.sessions) || !Array.isArray(state.robots)) throw Error('Formato de vila inválido');
      for (const robot of state.robots) {
        if (['working', 'reading', 'tool', 'waiting'].includes(robot.status)) robot.status = 'offline';
        robot.tools = [];
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { version: 1, accounts: [], sessions: [], robots: [] };
    }
    return new JsonStore(file, state, beforePersist);
  }
  transact(operation) {
    const transaction = this.queue.then(async () => {
      const next = structuredClone(this.state);
      const result = await operation(next);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await this.beforePersist?.();
        await mkdir(dirname(this.file), { recursive: true });
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.file);
      } catch {
        await unlink(temporary).catch(() => {});
        throw new VillageError(503, 'Não foi possível salvar. Tente novamente.');
      }
      this.state = next;
      return result;
    });
    this.queue = transaction.catch(() => {});
    return transaction;
  }
}

export class Village {
  constructor(store, { inviteCode, now = Date.now } = {}) {
    if (typeof inviteCode !== 'string' || inviteCode.length < 8) throw Error('INVITE_CODE precisa ter pelo menos 8 caracteres');
    this.store = store; this.inviteCode = inviteCode; this.now = now; this.presence = new Map();
  }
  authenticate(rawToken) {
    if (typeof rawToken !== 'string' || rawToken.length !== 64) throw new VillageError(401, 'Entre na sua conta.');
    const session = this.store.state.sessions.find(s => s.tokenHash === hash(rawToken) && s.expiresAt > this.now());
    const account = session && this.store.state.accounts.find(a => a.id === session.accountId);
    if (!account) throw new VillageError(401, 'Entre na sua conta.');
    return publicAccount(account);
  }
  issueSession(state, account) {
    const raw = token(), expiresAt = this.now() + SESSION_MS;
    state.sessions = state.sessions.filter(s => s.expiresAt > this.now());
    state.sessions.push({ tokenHash: hash(raw), accountId: account.id, expiresAt });
    return { token: raw, expiresAt, account: publicAccount(account) };
  }
  async register(input) {
    shape(input, ['username', 'displayName', 'password', 'inviteCode']);
    const username = text(input.username, 3, 24);
    if (!/^[a-z0-9_-]+$/.test(username)) invalid();
    const displayName = text(typeof input.displayName === 'string' ? input.displayName.trim() : input.displayName, 1, 32), password = text(input.password, 10, 128);
    if (typeof input.inviteCode !== 'string' || !safeEqual(input.inviteCode, this.inviteCode)) throw new VillageError(403, 'Código de convite inválido.');
    return this.store.transact(async state => {
      if (state.accounts.length >= 100) throw new VillageError(409, 'A vila atingiu o limite de moradores.');
      if (state.accounts.some(a => a.username === username)) throw new VillageError(409, 'Este nome de acesso já está em uso.');
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await derive(password, salt, 64)).toString('hex');
      const account = { id: randomUUID(), username, displayName, passwordHash, salt, deskSize: 'medium' };
      state.accounts.push(account);
      return this.issueSession(state, account);
    });
  }
  async login(input) {
    shape(input, ['username', 'password']);
    const username = text(input.username, 3, 24), password = text(input.password, 1, 128);
    const account = this.store.state.accounts.find(a => a.username === username);
    const expected = account?.passwordHash ?? '0'.repeat(128);
    const actual = (await derive(password, account?.salt ?? 'missing-account-salt', 64)).toString('hex');
    if (!safeEqual(actual, expected)) throw new VillageError(401, 'Nome de acesso ou senha incorretos.');
    return this.store.transact(state => this.issueSession(state, state.accounts.find(a => a.id === account.id)));
  }
  logout(rawToken) {
    return this.store.transact(state => { state.sessions = state.sessions.filter(s => s.tokenHash !== hash(rawToken)); });
  }
  async updateDesk(ownerId, input) {
    shape(input, ['deskSize']);
    if (!['small', 'medium', 'large'].includes(input.deskSize)) invalid();
    return this.store.transact(state => {
      const account = state.accounts.find(a => a.id === ownerId);
      if (!account) throw new VillageError(404, 'Morador não encontrado.');
      account.deskSize = input.deskSize;
      return publicAccount(account);
    });
  }
  async createRobot(ownerId, input) {
    shape(input, ['provider', 'sessionId', 'label', 'title', 'description']);
    if (!['codex', 'cursor', 'claude'].includes(input.provider)) invalid();
    const sessionId = text(input.sessionId, 1, 128), label = text(typeof input.label === 'string' ? input.label.trim() : input.label, 1, 32);
    const title = text(input.title ?? '', 0, 120), description = text(input.description ?? '', 0, 280);
    return this.store.transact(state => {
      if (!state.accounts.some(a => a.id === ownerId)) throw new VillageError(404, 'Morador não encontrado.');
      const owned = state.robots.filter(r => r.ownerId === ownerId);
      if (owned.length >= 12) throw new VillageError(409, 'Limite de 12 robôs por morador.');
      if (owned.some(r => r.provider === input.provider && r.sessionId === sessionId)) throw new VillageError(409, 'Este chat já tem um robô.');
      const raw = token();
      const robot = createRobots([{ id: randomUUID(), ownerId, provider: input.provider, sessionId, label, title, description, privacy: 'none', connectorHash: hash(raw), sequence: 0, simulated: false }])[0];
      state.robots.push(robot);
      return { robot: this.ownRobot(robot), token: raw };
    });
  }
  ownRobot(robot) {
    return { ...publicRobot(robot), sessionId: robot.sessionId, privacy: robot.privacy, title: robot.title, description: robot.description };
  }
  async updateRobot(ownerId, id, input) {
    shape(input, ['privacy', 'title', 'description', 'label']);
    if ('privacy' in input && !['none', 'title', 'description'].includes(input.privacy)) invalid();
    for (const [key, min, max] of [['title', 0, 120], ['description', 0, 280], ['label', 1, 32]]) if (key in input) text(input[key], min, max);
    return this.store.transact(state => { const robot = ownerRobot(state, ownerId, id); Object.assign(robot, input); return this.ownRobot(robot); });
  }
  deleteRobot(ownerId, id) {
    return this.store.transact(state => { ownerRobot(state, ownerId, id); state.robots = state.robots.filter(r => r.id !== id); });
  }
  rotateToken(ownerId, id) {
    return this.store.transact(state => { const robot = ownerRobot(state, ownerId, id), raw = token(); robot.connectorHash = hash(raw); robot.sequence = 0; return { token: raw }; });
  }
  async ingest(rawToken, input) {
    shape(input, ['sequence', 'event']);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) invalid();
    return this.store.transact(state => {
      if (typeof rawToken !== 'string' || rawToken.length !== 64) throw new VillageError(401, 'Token do robô inválido.');
      const robot = state.robots.find(r => r.connectorHash === hash(rawToken));
      if (!robot) throw new VillageError(401, 'Token do robô inválido.');
      const event = normalizeEvent(robot.provider, input.event);
      if (!event || event.sessionId !== robot.sessionId) invalid();
      if (input.sequence <= robot.sequence) return { accepted: false, status: robot.status };
      const accepted = Boolean(applyEvent([robot], event));
      robot.sequence = input.sequence;
      if (accepted) robot.lastSignalAt = this.now();
      return { accepted, status: robot.status };
    });
  }
  me(ownerId) {
    const account = this.store.state.accounts.find(a => a.id === ownerId);
    return { account: publicAccount(account), robots: this.store.state.robots.filter(r => r.ownerId === ownerId).map(r => this.ownRobot(r)) };
  }
  snapshot(viewerId) {
    const now = this.now();
    this.presence.set(viewerId, now);
    return {
      simulated: false, serverNow: now,
      members: this.store.state.accounts.map(a => ({ id: a.id, displayName: a.displayName, deskSize: a.deskSize, online: now - (this.presence.get(a.id) ?? -Infinity) < 20000 })),
      robots: this.store.state.robots.map(publicRobot),
    };
  }
}
