import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore, Village } from '../server/village.mjs';

const account = (username = 'renatin') => ({ username, displayName: username, password: 'senha-local-segura', inviteCode: 'friends-only' });
const event = (sessionId, action = 'turn/started', sequence = 1, parentSessionId) => ({ sequence, event: { method: action, params: { threadId: sessionId, ...(parentSessionId ? { parentSessionId } : {}), turn: { id: `turn-${sequence}` } } } });

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-village-auto-spawn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await JsonStore.open(join(dir, 'village.json'));
  const village = new Village(store, { inviteCode: 'friends-only' });
  const owner = (await village.register(account())).account;
  return { store, village, owner };
}

test('CONN-01/SPAWN-01: pairing creates only a connection and first signals spawn sessions', async t => {
  const { store, village, owner } = await setup(t);
  const pairing = await village.createPairing(owner.id, { provider: 'codex', label: 'Meu Codex' });
  assert.equal(store.state.robots.length, 0);
  const exchanged = await village.exchangePairing(pairing.pairing.code);
  assert.equal(exchanged.connection.provider, 'codex');
  assert.equal(exchanged.token.length, 64);
  assert.equal(store.state.robots.length, 0);
  const first = await village.ingest(exchanged.token, event('session-a'));
  assert.equal(first.accepted, true);
  assert.equal(first.spawned, true);
  assert.equal(store.state.robots.length, 1);
  assert.equal((await village.ingest(exchanged.token, event('session-a', 'turn/started', 2))).spawned, false);
  assert.equal(store.state.robots.length, 1);
  const second = await village.ingest(exchanged.token, event('session-b', 'turn/started', 3, 'session-a'));
  assert.equal(second.spawned, true);
  assert.equal(store.state.robots.length, 2);
  const own = village.me(owner.id);
  assert.equal(own.robots.find(robot => robot.id === second.robotId).parentSessionId, 'session-a');
  assert.equal(own.robots.find(robot => robot.id === second.robotId).parentRobotId, first.robotId);
  const publicView = village.snapshot('friend').robots;
  assert.equal('parentSessionId' in publicView[1], false);
  assert.equal('connectionId' in publicView[1], false);
  assert.equal('parentRobotId' in publicView[1], false);
});

test('CONN-02/LIFE-01: interleaved sessions and terminal events stay independent', async t => {
  const { store, village, owner } = await setup(t);
  const pairing = await village.createPairing(owner.id, { provider: 'claude', label: 'Claude' });
  const { token } = await village.exchangePairing(pairing.pairing.code);
  await village.ingest(token, { sequence: 1, event: { session_id: 'parent', hook_event_name: 'SessionStart' } });
  await village.ingest(token, { sequence: 2, event: { session_id: 'child', parent_session_id: 'parent', hook_event_name: 'UserPromptSubmit' } });
  await village.ingest(token, { sequence: 3, event: { session_id: 'parent', hook_event_name: 'SessionEnd' } });
  const parent = store.state.robots.find(robot => robot.sessionId === 'parent');
  const child = store.state.robots.find(robot => robot.sessionId === 'child');
  assert.equal(parent.status, 'offline');
  assert.equal(child.status, 'working');
  const late = await village.ingest(token, { sequence: 4, event: { session_id: 'parent', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'late' } });
  assert.equal(late.accepted, false);
  assert.equal(parent.status, 'offline');
});

test('EDGE-01: concurrent first events for one session persist one robot', async t => {
  const { store, village, owner } = await setup(t);
  const pairing = await village.createPairing(owner.id, { provider: 'codex', label: 'Codex' });
  const { token } = await village.exchangePairing(pairing.pairing.code);
  const results = await Promise.all([village.ingest(token, event('same', 'turn/started', 1)), village.ingest(token, event('same', 'turn/started', 2))]);
  assert.equal(store.state.robots.filter(robot => robot.sessionId === 'same').length, 1);
  assert.equal(results.filter(result => result.spawned).length, 1);
});

test('PRIV-01/CONN-03: connection defaults, rotation and revocation cover all sessions', async t => {
  const { store, village, owner } = await setup(t);
  const pairing = await village.createPairing(owner.id, { provider: 'codex', label: 'Codex' });
  const exchanged = await village.exchangePairing(pairing.pairing.code);
  await village.updateConnection(owner.id, exchanged.connection.id, { privacy: 'title' });
  await village.ingest(exchanged.token, event('session-a'));
  assert.equal(store.state.robots[0].privacy, 'title');
  const rotated = await village.rotateConnectionToken(owner.id, exchanged.connection.id);
  await assert.rejects(village.ingest(exchanged.token, event('old', 'turn/started', 2)), { status: 401 });
  await village.ingest(rotated.token, event('new', 'turn/started', 1));
  await village.deleteConnection(owner.id, exchanged.connection.id);
  await assert.rejects(village.ingest(rotated.token, event('deleted', 'turn/started', 2)), { status: 401 });
});

test('MIG-01: legacy robot state receives a synthesized connection on reopen', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-village-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = { version: 1, accounts: [{ id: 'owner', username: 'renatin', displayName: 'Renatin', passwordHash: 'hash', salt: 'salt', deskSize: 'medium' }], sessions: [], robots: [{ id: 'legacy-robot', ownerId: 'owner', provider: 'codex', sessionId: 'legacy-session', label: 'Codex', title: '', description: '', privacy: 'none', connectorHash: 'legacy-hash', sequence: 0, simulated: false, pairingId: null, provisioned: true, status: 'idle', runId: null, tools: [], lastSignalAt: null }], pairings: [] };
  const file = join(dir, 'village.json');
  await writeFile(file, JSON.stringify(state));
  const store = await JsonStore.open(file);
  assert.equal(store.state.connections.length, 1);
  assert.equal(store.state.robots[0].connectionId, 'legacy-robot');
});
