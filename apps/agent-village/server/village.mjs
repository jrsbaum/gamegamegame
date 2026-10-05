import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRobots, normalizeEvent, applyEvent, publicRobot } from './events.mjs';

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const PAIRING_MS = 10 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
const token = () => randomBytes(32).toString('hex');
const pairingCode = () => `VILA-${randomBytes(6).toString('hex').toUpperCase()}`;
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
const ownerConnection = (state, ownerId, id) => {
  const connection = state.connections.find(c => c.id === id && c.ownerId === ownerId);
  if (!connection) throw new VillageError(404, 'Conexão não encontrada.');
  return connection;
};
const purgePairings = (state, now) => {
  const expired = new Set(state.pairings.filter(pairing => pairing.expiresAt <= now).map(pairing => pairing.connectionId ?? pairing.robotId));
  if (!expired.size) return;
  state.pairings = state.pairings.filter(pairing => !expired.has(pairing.connectionId ?? pairing.robotId));
  state.connections = state.connections.filter(connection => !expired.has(connection.id) || connection.provisioned);
  // Pairings created by the previous release had a pending robot instead of a
  // connection. Keep their cleanup behavior during the migration window.
  state.robots = state.robots.filter(robot => !expired.has(robot.id) || robot.provisioned);
};

export class JsonStore {
  constructor(file, state, beforePersist) { this.file = file; this.state = state; this.beforePersist = beforePersist; this.queue = Promise.resolve(); }
  static async open(file, { beforePersist } = {}) {
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.accounts) || !Array.isArray(state.sessions) || !Array.isArray(state.robots)) throw Error('Formato de vila inválido');
      if (!Array.isArray(state.pairings)) state.pairings = [];
      if (!Array.isArray(state.connections)) state.connections = [];
      for (const robot of state.robots) {
        if (['working', 'reading', 'tool', 'waiting'].includes(robot.status)) { robot.status = 'offline'; robot.offlineReason = 'restart'; }
        robot.tools = [];
        robot.pairingId ??= null;
        robot.provisioned ??= true;
        robot.connectionId ??= robot.id;
        robot.parentSessionId ??= null;
        robot.parentRobotId ??= null;
        if (!state.connections.some(connection => connection.id === robot.connectionId)) {
          state.connections.push({
            id: robot.connectionId, ownerId: robot.ownerId, provider: robot.provider,
            label: robot.label, defaultPrivacy: robot.privacy ?? 'none', privacy: robot.privacy ?? 'none',
            connectorHash: robot.connectorHash, provisioned: robot.provisioned,
            pairingId: robot.pairingId ?? null, sequence: robot.sequence ?? 0,
            createdAt: null, lastSignalAt: robot.lastSignalAt ?? null, legacy: true,
          });
        }
      }
      for (const pairing of state.pairings) pairing.connectionId ??= pairing.robotId;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { version: 1, accounts: [], sessions: [], robots: [], pairings: [], connections: [] };
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
    this.store = store; this.inviteCode = inviteCode; this.now = now; this.presence = new Map(); this.listeners = new Set();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(ownerId) { for (const listener of this.listeners) { try { listener(ownerId); } catch { /* observers cannot break the store */ } } }
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
      const connectionId = randomUUID();
      const robot = createRobots([{ id: randomUUID(), ownerId, connectionId, provider: input.provider, sessionId, label, title, description, privacy: 'none', connectorHash: hash(raw), sequence: 0, simulated: false, pairingId: null, provisioned: true }])[0];
      state.connections.push({ id: connectionId, ownerId, provider: input.provider, label, defaultPrivacy: 'none', privacy: 'none', connectorHash: hash(raw), provisioned: true, pairingId: null, sequence: 0, createdAt: this.now(), lastSignalAt: null, legacy: true });
      state.robots.push(robot);
      return { robot: this.ownRobot(robot), token: raw };
    });
  }
  async createPairing(ownerId, input) {
    shape(input, ['provider', 'label', 'privacy', 'defaultPrivacy']);
    if (!['codex', 'claude'].includes(input.provider)) invalid();
    const label = text(typeof input.label === 'string' ? input.label.trim() : input.label, 1, 32);
    const privacy = input.defaultPrivacy ?? input.privacy ?? 'none';
    if (!['none', 'title', 'description'].includes(privacy)) invalid();
    return this.store.transact(state => {
      const now = this.now();
      purgePairings(state, now);
      if (!state.accounts.some(a => a.id === ownerId)) throw new VillageError(404, 'Morador não encontrado.');
      const id = randomUUID(), rawCode = pairingCode();
      const connection = { id: randomUUID(), ownerId, provider: input.provider, label, defaultPrivacy: privacy, privacy, connectorHash: null, provisioned: false, pairingId: id, sequence: 0, createdAt: now, lastSignalAt: null };
      state.connections.push(connection);
      state.pairings.push({ id, connectionId: connection.id, ownerId, provider: input.provider, pairingHash: hash(rawCode), expiresAt: now + PAIRING_MS });
      return { pairing: { id, code: rawCode, expiresAt: now + PAIRING_MS, provider: input.provider, label }, connection: this.ownConnection(connection) };
    });
  }
  async exchangePairing(rawCode) {
    if (typeof rawCode !== 'string') invalid();
    const code = rawCode.trim().toUpperCase();
    if (code.length < 8 || code.length > 40) invalid();
    const candidate = this.store.state.pairings.find(pairing => safeEqual(pairing.pairingHash, hash(code)));
    if (candidate?.expiresAt <= this.now()) {
      await this.store.transact(state => { purgePairings(state, this.now()); return null; });
      throw new VillageError(410, 'Código expirado ou inválido. Gere um novo código na vila.');
    }
    return this.store.transact(state => {
      const now = this.now();
      purgePairings(state, now);
      const pairing = state.pairings.find(candidate => safeEqual(candidate.pairingHash, hash(code)));
      if (!pairing) throw new VillageError(410, 'Código expirado ou inválido. Gere um novo código na vila.');
      const connection = state.connections.find(candidate => candidate.id === (pairing.connectionId ?? pairing.robotId) && !candidate.provisioned);
      if (!connection) {
        // Old pairings point at a pending robot. They are upgraded in place so
        // a release can be deployed without asking the owner to reinstall.
        const legacy = state.robots.find(candidate => candidate.id === pairing.robotId && !candidate.provisioned);
        if (!legacy) throw new VillageError(410, 'Código expirado ou inválido. Gere um novo código na vila.');
        const rawToken = token();
        legacy.connectorHash = hash(rawToken); legacy.provisioned = true; legacy.status = 'idle'; legacy.pairingId = null;
        const migrated = state.connections.find(candidate => candidate.id === legacy.connectionId) ?? { id: legacy.connectionId, ownerId: legacy.ownerId, provider: legacy.provider, label: legacy.label, defaultPrivacy: legacy.privacy ?? 'none', privacy: legacy.privacy ?? 'none', sequence: legacy.sequence ?? 0, createdAt: now, lastSignalAt: null, legacy: true };
        migrated.connectorHash = hash(rawToken); migrated.provisioned = true; migrated.pairingId = null;
        if (!state.connections.some(candidate => candidate.id === migrated.id)) state.connections.push(migrated);
        state.pairings = state.pairings.filter(candidate => candidate.id !== pairing.id);
        return { connection: this.ownConnection(migrated), robot: this.ownRobot(legacy), token: rawToken };
      }
      const rawToken = token();
      connection.connectorHash = hash(rawToken);
      connection.provisioned = true;
      connection.pairingId = null;
      const pendingLegacy = state.robots.find(candidate => candidate.id === connection.id && !candidate.provisioned);
      if (pendingLegacy) {
        pendingLegacy.connectorHash = hash(rawToken);
        pendingLegacy.provisioned = true;
        pendingLegacy.status = 'idle';
        pendingLegacy.pairingId = null;
        connection.legacy = true;
      }
      state.pairings = state.pairings.filter(candidate => candidate.id !== pairing.id);
      return { connection: this.ownConnection(connection), ...(pendingLegacy ? { robot: this.ownRobot(pendingLegacy) } : {}), token: rawToken };
    });
  }
  ownConnection(connection) {
    const privacy = connection.defaultPrivacy ?? connection.privacy ?? 'none';
    return { id: connection.id, provider: connection.provider, label: connection.label, privacy, defaultPrivacy: privacy, provisioned: Boolean(connection.provisioned), installed: Boolean(connection.provisioned), lastSignalAt: connection.lastSignalAt ?? null };
  }
  ownRobot(robot) {
    return { ...publicRobot(robot), connectionId: robot.connectionId ?? null, sessionId: robot.sessionId, parentSessionId: robot.parentSessionId ?? null, parentRobotId: robot.parentRobotId ?? null, privacy: robot.privacy, title: robot.title, description: robot.description };
  }
  async updateConnection(ownerId, id, input) {
    shape(input, ['privacy', 'defaultPrivacy', 'label']);
    const requestedPrivacy = input.defaultPrivacy ?? input.privacy;
    if (requestedPrivacy !== undefined && !['none', 'title', 'description'].includes(requestedPrivacy)) invalid();
    if ('label' in input) text(typeof input.label === 'string' ? input.label.trim() : input.label, 1, 32);
    return this.store.transact(state => {
      const connection = ownerConnection(state, ownerId, id);
      if (requestedPrivacy !== undefined) connection.defaultPrivacy = requestedPrivacy;
      if ('label' in input) connection.label = input.label.trim();
      return this.ownConnection(connection);
    });
  }
  async rotateConnectionToken(ownerId, id) {
    return this.store.transact(state => {
      const connection = ownerConnection(state, ownerId, id), raw = token();
      connection.connectorHash = hash(raw); connection.sequence = 0;
      return { token: raw };
    });
  }
  deleteConnection(ownerId, id) {
    return this.store.transact(state => {
      ownerConnection(state, ownerId, id);
      state.connections = state.connections.filter(connection => connection.id !== id);
      state.robots = state.robots.filter(robot => robot.connectionId !== id && robot.id !== id);
      state.pairings = state.pairings.filter(pairing => (pairing.connectionId ?? pairing.robotId) !== id);
    });
  }
  async updateRobot(ownerId, id, input) {
    shape(input, ['privacy', 'title', 'description', 'label']);
    if ('privacy' in input && !['none', 'title', 'description'].includes(input.privacy)) invalid();
    for (const [key, min, max] of [['title', 0, 120], ['description', 0, 280], ['label', 1, 32]]) if (key in input) text(input[key], min, max);
    return this.store.transact(state => { const robot = ownerRobot(state, ownerId, id); Object.assign(robot, input); return this.ownRobot(robot); });
  }
  deleteRobot(ownerId, id) {
    return this.store.transact(state => {
      const robot = ownerRobot(state, ownerId, id);
      state.robots = state.robots.filter(r => r.id !== id);
      state.pairings = state.pairings.filter(pairing => (pairing.connectionId ?? pairing.robotId) !== (robot.connectionId ?? id));
      const connection = state.connections.find(candidate => candidate.id === robot.connectionId);
      if (connection?.legacy) state.connections = state.connections.filter(candidate => candidate.id !== connection.id);
    });
  }
  rotateToken(ownerId, id) {
    return this.store.transact(state => { const robot = ownerRobot(state, ownerId, id), raw = token(); robot.connectorHash = hash(raw); robot.sequence = 0; const connection = state.connections.find(candidate => candidate.id === robot.connectionId); if (connection) { connection.connectorHash = hash(raw); connection.sequence = 0; } return { token: raw }; });
  }
  async ingest(rawToken, input) {
    shape(input, ['sequence', 'event']);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) invalid();
    const result = await this.store.transact(state => {
      if (typeof rawToken !== 'string' || rawToken.length !== 64) throw new VillageError(401, 'Token do robô inválido.');
      let connection = state.connections.find(candidate => candidate.connectorHash === hash(rawToken));
      let legacyRobot = null;
      if (!connection) {
        legacyRobot = state.robots.find(r => r.connectorHash === hash(rawToken));
        if (legacyRobot) connection = state.connections.find(candidate => candidate.id === legacyRobot.connectionId) ?? legacyRobot;
      }
      if (!connection) throw new VillageError(401, 'Token da conexão inválido.');
      if (!connection.provisioned) throw new VillageError(401, 'Token da conexão inválido.');
      const event = normalizeEvent(connection.provider, input.event);
      if (!event) invalid();
      const legacyMode = Boolean(connection.legacy);
      if (legacyMode) {
        legacyRobot ??= state.robots.find(candidate => candidate.connectionId === connection.id && candidate.provider === event.provider);
        if (legacyRobot && legacyRobot.sessionId !== event.sessionId) invalid();
      }
      if (input.sequence <= (connection.sequence ?? 0)) {
        const repeated = state.robots.find(r => r.connectionId === connection.id && r.provider === event.provider && r.sessionId === event.sessionId);
        return { accepted: false, status: repeated?.status ?? 'idle', robotId: repeated?.id ?? null, spawned: false };
      }
      let robot = state.robots.find(candidate => candidate.connectionId === connection.id && candidate.provider === event.provider && candidate.sessionId === event.sessionId);
      let spawned = false;
      if (!robot) {
        // New connections have no robot rows at pairing time. The first valid
        // event creates exactly one row inside this serial transaction.
        const siblingCount = state.robots.filter(candidate => candidate.connectionId === connection.id).length;
        const label = siblingCount ? `${connection.label} ${siblingCount + 1}`.slice(0, 32) : connection.label;
        const parent = event.parentSessionId && state.robots.find(candidate => candidate.connectionId === connection.id && candidate.sessionId === event.parentSessionId);
        robot = createRobots([{ id: randomUUID(), ownerId: connection.ownerId, connectionId: connection.id, provider: connection.provider, sessionId: event.sessionId, parentSessionId: event.parentSessionId ?? null, parentRobotId: parent?.id ?? null, label, title: '', description: '', privacy: connection.defaultPrivacy ?? connection.privacy ?? 'none', connectorHash: null, sequence: 0, simulated: false, pairingId: null, provisioned: true }])[0];
        state.robots.push(robot);
        spawned = true;
      } else if (event.parentSessionId && !robot.parentSessionId) {
        robot.parentSessionId = event.parentSessionId;
        const parent = state.robots.find(candidate => candidate.connectionId === connection.id && candidate.sessionId === event.parentSessionId);
        robot.parentRobotId = parent?.id ?? null;
      }
      if (robot.offlineReason === 'restart') { robot.offlineReason = null; robot.status = 'idle'; }
      for (const child of state.robots) {
        if (child.connectionId === connection.id && child.parentSessionId === robot.sessionId && !child.parentRobotId) child.parentRobotId = robot.id;
      }
      // Compatibility path for a pre auto-spawn robot: its token lives on the
      // robot row and its connection was synthesized at startup.
      if (legacyRobot && robot.id !== legacyRobot.id && legacyRobot.sessionId === event.sessionId) robot = legacyRobot;
      const accepted = Boolean(applyEvent([robot], event));
      connection.sequence = input.sequence;
      connection.lastSignalAt = this.now();
      robot.sequence = input.sequence;
      if (accepted) robot.lastSignalAt = this.now();
      return legacyMode ? { accepted, status: robot.status } : { accepted, status: robot.status, robotId: robot.id, spawned };
    });
    const connection = this.store.state.connections.find(candidate => candidate.connectorHash === hash(rawToken));
    if (connection) this.notify(connection.ownerId);
    return result;
  }
  me(ownerId) {
    const account = this.store.state.accounts.find(a => a.id === ownerId);
    return { account: publicAccount(account), connections: this.store.state.connections.filter(connection => connection.ownerId === ownerId).map(connection => this.ownConnection(connection)), robots: this.store.state.robots.filter(r => r.ownerId === ownerId).map(r => this.ownRobot(r)) };
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
