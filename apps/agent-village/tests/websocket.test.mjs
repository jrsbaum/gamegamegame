import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { JsonStore, Village } from '../server/village.mjs';
import { createVillageServer } from '../server/http.mjs';

function nextMessage(socket, timeout = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeAllListeners('message'); reject(new Error('websocket message timeout')); }, timeout);
    socket.once('message', raw => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); });
  });
}

test('WS-01/WS-02: same-origin websocket authenticates by cookie and broadcasts event snapshots', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'village-ws-'));
  const dist = join(dir, 'dist'); await mkdir(dist); await writeFile(join(dist, 'index.html'), '<html>Vila</html>');
  const village = new Village(await JsonStore.open(join(dir, 'state.json')), { inviteCode: 'friends-only' });
  const server = createVillageServer(village, { publicOrigin: 'http://localhost:5176', dist });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const cookieResponse = await fetch(`http://127.0.0.1:${port}/api/auth/register`, { method: 'POST', headers: { Origin: 'http://localhost:5176', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'socket-owner', displayName: 'Socket owner', password: 'senha-local-segura', inviteCode: 'friends-only' }) });
  const cookie = cookieResponse.headers.get('set-cookie').split(';')[0];
  const friendResponse = await fetch(`http://127.0.0.1:${port}/api/auth/register`, { method: 'POST', headers: { Origin: 'http://localhost:5176', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'socket-friend', displayName: 'Socket friend', password: 'senha-local-segura', inviteCode: 'friends-only' }) });
  const friendCookie = friendResponse.headers.get('set-cookie').split(';')[0];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
  const friendSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: friendCookie } });
  t.after(async () => { socket.close(); friendSocket.close(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const helloPromise = nextMessage(socket);
  const friendHelloPromise = nextMessage(friendSocket);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await new Promise((resolve, reject) => { friendSocket.once('open', resolve); friendSocket.once('error', reject); });
  const hello = await helloPromise;
  const friendHello = await friendHelloPromise;
  assert.equal(hello.type, 'hello');
  assert.equal(friendHello.type, 'hello');
  assert.equal(hello.snapshot.robots.length, 0);

  const owner = village.store.state.accounts[0];
  const pairing = await village.createPairing(owner.id, { provider: 'codex', label: 'Codex local' });
  const { token } = await village.exchangePairing(pairing.pairing.code);
  const ownerUpdatePromise = nextMessage(socket);
  const friendUpdatePromise = nextMessage(friendSocket);
  await village.ingest(token, { sequence: 1, event: { method: 'turn/started', params: { threadId: 'socket-session', turn: { id: 'turn-1' } } } });
  const update = await ownerUpdatePromise;
  const friendUpdate = await friendUpdatePromise;
  assert.equal(update.type, 'snapshot');
  assert.equal(friendUpdate.type, 'snapshot');
  assert.equal(update.snapshot.robots.length, 1);
  assert.equal(friendUpdate.snapshot.robots.length, 1);
  assert.equal('sessionId' in update.snapshot.robots[0], false);
});

test('WS-03: invalid websocket cookies are rejected before upgrade', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'village-ws-auth-'));
  const dist = join(dir, 'dist'); await mkdir(dist); await writeFile(join(dist, 'index.html'), '<html>Vila</html>');
  const village = new Village(await JsonStore.open(join(dir, 'state.json')), { inviteCode: 'friends-only' });
  const server = createVillageServer(village, { publicOrigin: 'http://localhost:5176', dist });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  t.after(async () => { socket.close(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  await assert.rejects(new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('unexpected-response', (_request, response) => reject(new Error(`unexpected ${response.statusCode}`))); socket.once('error', reject); }), /unexpected 401/);
});
