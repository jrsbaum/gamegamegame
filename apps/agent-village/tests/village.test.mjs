import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore, Village, SESSION_MS } from '../server/village.mjs';

const account = (username = 'renatin') => ({ username, displayName: username, password: 'senha-local-segura', inviteCode: 'friends-only' });
const robot = (sessionId = 'secret-thread') => ({ provider: 'codex', sessionId, label: 'Codex 1', title: 'Título privado', description: 'Descrição privada' });
const start = sessionId => ({ method: 'turn/started', params: { threadId: sessionId, turn: { id: 'turn1' }, prompt: 'não salvar prompt' } });
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-village-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'village.json');
  const store = await JsonStore.open(file, options);
  let clock = 1000;
  const village = new Village(store, { inviteCode: 'friends-only', now: () => clock });
  return { file, store, village, clock: value => { clock = value; } };
}

test('AUTH-01..03: isolated registration, scrypt, login, expiry and revoke', async t => {
  const { village, file, clock } = await setup(t);
  await assert.rejects(village.register({ ...account(), inviteCode: 'wrong' }), { status: 403 });
  await assert.rejects(village.register({ ...account(), password: 'short' }), { status: 400 });
  const session = await village.register(account());
  assert.equal(session.account.deskSize, 'medium');
  assert.equal(session.expiresAt, 1000 + SESSION_MS);
  assert.equal(village.authenticate(session.token).username, 'renatin');
  const stored = await readFile(file, 'utf8');
  assert.equal(stored.includes('senha-local-segura'), false);
  assert.equal(stored.includes(session.token), false);
  await assert.rejects(village.login({ username: 'renatin', password: 'wrong-password' }), { status: 401 });
  const login = await village.login({ username: 'renatin', password: account().password });
  assert.equal(login.account.id, session.account.id);
  await village.logout(login.token);
  assert.throws(() => village.authenticate(login.token), { status: 401 });
  clock(1000 + SESSION_MS);
  assert.throws(() => village.authenticate(session.token), { status: 401 });
});

test('WORLD-03/AUTH-04/ROBOT-01/05: only owner edits desk/robots and privacy defaults none', async t => {
  const { village } = await setup(t);
  const a = (await village.register(account())).account;
  const b = (await village.register(account('julin'))).account;
  await village.updateDesk(a.id, { deskSize: 'large' });
  assert.equal(village.me(a.id).account.deskSize, 'large');
  await assert.rejects(village.updateDesk(a.id, { deskSize: 'giant' }), { status: 400 });
  const created = await village.createRobot(a.id, robot());
  assert.equal(created.robot.privacy, 'none');
  assert.equal(created.robot.status, 'idle');
  assert.equal(created.token.length, 64);
  assert.equal(JSON.stringify(village.me(a.id)).includes(created.token), false);
  for (const action of [() => village.updateRobot(b.id, created.robot.id, { privacy: 'description' }), () => village.deleteRobot(b.id, created.robot.id), () => village.rotateToken(b.id, created.robot.id)]) {
    await assert.rejects(action(), { status: 404 });
  }
  await assert.rejects(village.createRobot(a.id, robot()), { status: 409 });
  await assert.rejects(village.updateRobot(a.id, created.robot.id, { privacy: 'all' }), { status: 400 });
  assert.equal(village.me(a.id).robots[0].privacy, 'none');
});

test('ROBOT-04/05: friend snapshot never exposes hidden metadata or provider session IDs', async t => {
  const { village } = await setup(t);
  const a = (await village.register(account())).account;
  const b = (await village.register(account('julin'))).account;
  const created = await village.createRobot(a.id, robot());
  let view = village.snapshot(b.id).robots[0];
  assert.deepEqual(Object.keys(view).sort(), ['id', 'label', 'lastSignalAt', 'ownerId', 'provider', 'simulated', 'status']);
  assert.equal(JSON.stringify(village.snapshot(b.id)).includes('secret-thread'), false);
  await village.updateRobot(a.id, created.robot.id, { privacy: 'title' });
  view = village.snapshot(b.id).robots[0];
  assert.equal(view.title, 'Título privado');
  assert.equal('description' in view, false);
  await village.updateRobot(a.id, created.robot.id, { privacy: 'description' });
  assert.equal(village.snapshot(b.id).robots[0].description, 'Descrição privada');
  await village.updateRobot(a.id, created.robot.id, { privacy: 'none' });
  assert.equal('title' in village.snapshot(b.id).robots[0], false);
});

test('ROBOT-02/03/06: token fixes ownership/session, sequence orders concurrent chats, offline owner continues', async t => {
  const { village, clock } = await setup(t);
  const a = (await village.register(account())).account;
  const b = (await village.register(account('julin'))).account;
  const first = await village.createRobot(a.id, robot('one'));
  const second = await village.createRobot(a.id, robot('two'));
  village.snapshot(a.id);
  clock(21001);
  await assert.rejects(village.ingest('bad', { sequence: 1, event: start('one') }), { status: 401 });
  await assert.rejects(village.ingest(first.token, { sequence: 1, event: start('two') }), { status: 400 });
  assert.deepEqual(await village.ingest(first.token, { sequence: 2, event: start('one') }), { accepted: true, status: 'working' });
  assert.deepEqual(await village.ingest(first.token, { sequence: 1, event: start('one') }), { accepted: false, status: 'working' });
  assert.equal(village.snapshot(b.id).members.find(m => m.id === a.id).online, false);
  assert.equal(village.me(a.id).robots.find(r => r.id === second.robot.id).status, 'idle');
  assert.equal(village.snapshot(b.id).robots.find(r => r.id === first.robot.id).lastSignalAt, 21001);
});

test('ROBOT-07: rotation and deletion revoke collector tokens', async t => {
  const { village } = await setup(t);
  const a = (await village.register(account())).account;
  const created = await village.createRobot(a.id, robot());
  const rotated = await village.rotateToken(a.id, created.robot.id);
  await assert.rejects(village.ingest(created.token, { sequence: 1, event: start('secret-thread') }), { status: 401 });
  assert.equal((await village.ingest(rotated.token, { sequence: 1, event: start('secret-thread') })).accepted, true);
  await village.deleteRobot(a.id, created.robot.id);
  await assert.rejects(village.ingest(rotated.token, { sequence: 2, event: start('secret-thread') }), { status: 401 });
  assert.deepEqual(village.me(a.id).robots, []);
});

test('OPS-01: reopening restores configuration/auth and marks active work offline', async t => {
  const { village, file } = await setup(t);
  const session = await village.register(account());
  await village.updateDesk(session.account.id, { deskSize: 'small' });
  const created = await village.createRobot(session.account.id, robot());
  await village.updateRobot(session.account.id, created.robot.id, { privacy: 'description' });
  await village.ingest(created.token, { sequence: 4, event: start('secret-thread') });
  const reopened = new Village(await JsonStore.open(file), { inviteCode: 'friends-only', now: () => 2000 });
  assert.equal(reopened.authenticate(session.token).id, session.account.id);
  assert.equal(reopened.me(session.account.id).account.deskSize, 'small');
  assert.equal(reopened.me(session.account.id).robots[0].privacy, 'description');
  assert.equal(reopened.me(session.account.id).robots[0].status, 'offline');
  assert.equal((await reopened.ingest(created.token, { sequence: 5, event: start('secret-thread') })).status, 'working');
  const raw = await readFile(file, 'utf8');
  assert.equal(raw.includes('não salvar prompt'), false);
  assert.equal(raw.includes(created.token), false);
});

test('OPS-01: failed persistence rolls back and serial concurrent mutations are retained', async t => {
  let fail = false;
  const { village, store } = await setup(t, { beforePersist: () => { if (fail) throw Error('disk'); } });
  const a = (await village.register(account())).account;
  fail = true;
  await assert.rejects(village.updateDesk(a.id, { deskSize: 'large' }), { status: 503 });
  assert.equal(village.me(a.id).account.deskSize, 'medium');
  fail = false;
  await Promise.all([village.createRobot(a.id, robot('one')), village.createRobot(a.id, robot('two'))]);
  assert.equal(store.state.robots.length, 2);
  assert.deepEqual(village.me(a.id).robots.map(r => r.sessionId), ['one', 'two']);
});

test('EDGE-02/04: bounds, unknown fields and per-account limit are enforced', async t => {
  const { village, store } = await setup(t);
  const a = (await village.register(account())).account;
  for (const input of [{ ...robot(), title: 'x'.repeat(121) }, { ...robot(), description: 'x'.repeat(281) }, { ...robot(), sessionId: 'x'.repeat(129) }, { ...robot(), label: 'bad\u0000label' }, { ...robot(), ownerId: 'forged' }]) {
    await assert.rejects(village.createRobot(a.id, input), { status: 400 });
  }
  for (let i = 0; i < 12; i++) await village.createRobot(a.id, robot(String(i)));
  await assert.rejects(village.createRobot(a.id, robot('thirteenth')), { status: 409 });
  assert.equal(village.me(a.id).robots.length, 12);
  store.state.accounts = Array.from({ length: 100 }, (_, i) => ({ id: String(i), username: String(i) }));
  await assert.rejects(village.register(account('overflow')), { status: 409 });
});

test('EDGE-05: corrupted state is never replaced on startup', async t => {
  const { file } = await setup(t);
  await writeFile(file, '{broken');
  await assert.rejects(JsonStore.open(file));
  assert.equal(await readFile(file, 'utf8'), '{broken');
});
