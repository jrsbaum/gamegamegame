import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore, Village } from '../server/village.mjs';
import { createVillageServer } from '../server/http.mjs';

async function setup(t, secure = false, trustProxy = false) {
  const dir = await mkdtemp(join(tmpdir(), 'village-http-'));
  const dist = join(dir, 'dist');
  await mkdir(dist);
  await writeFile(join(dist, 'index.html'), '<html>Vila dos Agentes</html>');
  const village = new Village(await JsonStore.open(join(dir, 'state.json')), { inviteCode: 'friends-only' });
  const origin = secure ? 'https://agents.gamegamegame.site' : 'http://localhost:5176';
  const server = createVillageServer(village, { publicOrigin: origin, dist, trustProxy });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', data, cookie, bearer, requestOrigin = origin, raw, forwarded } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(method !== 'GET' ? { Origin: requestOrigin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}) }, body: raw ?? (data ? JSON.stringify(data) : undefined) });
    return { status: response.status, headers: response.headers, body: await response.text() };
  };
  const register = async username => {
    const response = await request('/api/auth/register', { method: 'POST', data: { username, displayName: username, password: 'senha-local-segura', inviteCode: 'friends-only' } });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { request, register, village };
}

test('OPS-02/WORLD-01: same-origin client, healthz and server-filtered fictional demo', async t => {
  const { request } = await setup(t);
  assert.deepEqual(JSON.parse((await request('/healthz')).body), { ok: true, service: 'agent-village' });
  assert.equal((await request('/')).body, '<html>Vila dos Agentes</html>');
  const demo = JSON.parse((await request('/api/demo?step=5')).body);
  assert.equal(demo.simulated, true);
  assert.deepEqual(demo.members.map(m => m.displayName), ['Você (demo)', 'Renatin', 'Julin']);
  assert.equal(demo.robots.length, 5);
  assert.equal(demo.robots[0].status, 'tool');
  assert.equal('title' in demo.robots[0], false);
  assert.equal(demo.robots.every(r => !('sessionId' in r)), true);
  assert.equal((await request('/api/demo?step=-1')).status, 400);
  assert.equal((await request('/api/missing')).status, 404);
});

test('AUTH-01..03/05: cookies secure on HTTPS, auth boundary, origin and logout', async t => {
  const { request } = await setup(t, true);
  assert.equal((await request('/api/village')).status, 401);
  const input = { username: 'renatin', displayName: 'Renatin', password: 'senha-local-segura', inviteCode: 'friends-only' };
  assert.equal((await request('/api/auth/register', { method: 'POST', data: { ...input, inviteCode: 'wrong' } })).status, 403);
  assert.equal((await request('/api/auth/register', { method: 'POST', data: input, requestOrigin: 'https://evil.example' })).status, 403);
  const response = await request('/api/auth/register', { method: 'POST', data: input });
  assert.equal(response.status, 201);
  const setCookie = response.headers.get('set-cookie');
  for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Max-Age=2592000', 'Secure']) assert.equal(setCookie.includes(attribute), true);
  assert.equal(JSON.stringify(JSON.parse(response.body)).includes('token'), false);
  const cookie = setCookie.split(';')[0];
  assert.equal((await request('/api/me', { cookie })).status, 200);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: { username: 'renatin', password: 'wrong-password' } })).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', data: {}, cookie })).status, 200);
  assert.equal((await request('/api/me', { cookie })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: { username: 'renatin', password: input.password } })).status, 200);
});

test('AUTH-04/ROBOT-02/04/05/07: cross-owner HTTP edits fail and collector cannot forge its session', async t => {
  const { request, register } = await setup(t);
  const a = await register('renatin'), b = await register('julin');
  const created = JSON.parse((await request('/api/robots', { method: 'POST', cookie: a, data: { provider: 'codex', label: 'Codex', sessionId: 'private-chat', title: 'segredo-titulo', description: 'segredo-descricao' } })).body);
  const path = `/api/robots/${created.robot.id}`;
  for (const [suffix, method, data] of [['', 'PATCH', { privacy: 'description' }], ['', 'DELETE', {}], ['/token', 'POST', {}]]) assert.equal((await request(path + suffix, { method, data, cookie: b })).status, 404);
  assert.equal((await request('/api/desk', { method: 'PATCH', cookie: a, data: { deskSize: 'small', ownerId: 'forged' } })).status, 400);
  assert.equal((await request('/api/desk', { method: 'PATCH', cookie: a, data: { deskSize: 'small' } })).status, 200);
  const events = { sequence: 1, event: { method: 'turn/started', params: { threadId: 'private-chat', turn: { id: 'turn' } } } };
  assert.equal((await request('/api/events', { method: 'POST', cookie: a, data: events })).status, 401);
  assert.equal((await request('/api/events', { method: 'POST', bearer: created.token, data: { ...events, ownerId: 'forged' } })).status, 400);
  assert.equal((await request('/api/events', { method: 'POST', bearer: created.token, data: { ...events, event: { method: 'turn/started', params: { threadId: 'another-chat' } } } })).status, 400);
  assert.deepEqual(JSON.parse((await request('/api/events', { method: 'POST', bearer: created.token, data: events })).body), { accepted: true, status: 'working' });
  let snapshot = (await request('/api/village', { cookie: b })).body;
  for (const hidden of ['private-chat', 'segredo-titulo', 'segredo-descricao', created.token, 'connectorHash']) assert.equal(snapshot.includes(hidden), false);
  assert.equal((await request(path, { method: 'PATCH', cookie: a, data: { privacy: 'title' } })).status, 200);
  snapshot = (await request('/api/village', { cookie: b })).body;
  assert.equal(snapshot.includes('segredo-titulo'), true);
  assert.equal(snapshot.includes('segredo-descricao'), false);
  assert.equal((await request(path, { method: 'PATCH', cookie: a, data: { privacy: 'description' } })).status, 200);
  assert.equal((await request('/api/village', { cookie: b })).body.includes('segredo-descricao'), true);
  const rotated = JSON.parse((await request(path + '/token', { method: 'POST', cookie: a, data: {} })).body);
  assert.equal((await request('/api/events', { method: 'POST', bearer: created.token, data: events })).status, 401);
  assert.equal((await request('/api/events', { method: 'POST', bearer: rotated.token, data: events })).status, 200);
  assert.equal((await request(path, { method: 'DELETE', cookie: a, data: {} })).status, 200);
  assert.equal((await request('/api/events', { method: 'POST', bearer: rotated.token, data: events })).status, 401);
});

test('EDGE-01/02/AUTH-05: bad JSON, large body, unknown fields and auth rate limit', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/auth/login', { method: 'POST', raw: '{bad' })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', raw: 'x'.repeat(32769) })).status, 413);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: { username: 'abc', password: 'valid-secret', secret: 'never-reflect' } })).status, 400);
  let response;
  for (let i = 0; i < 20; i++) response = await request('/api/auth/login', { method: 'POST', data: { username: 'abc', password: 'wrong-password' } });
  assert.equal(response.status, 429);
  assert.equal(response.body.includes('wrong-password'), false);
});

test('AUTH-05/OPS-03: forwarded client IP is used only with an explicitly trusted proxy', async t => {
  const direct = await setup(t);
  const input = { method: 'POST', data: { unknown: 'invalid' } };
  for (let i = 0; i < 20; i++) await direct.request('/api/auth/login', { ...input, forwarded: `192.0.2.${i + 1}` });
  assert.equal((await direct.request('/api/auth/login', { ...input, forwarded: '198.51.100.9' })).status, 429);
  const proxied = await setup(t, false, true);
  for (let i = 0; i < 20; i++) await proxied.request('/api/auth/login', { ...input, forwarded: `192.0.2.${i + 1}, 198.51.100.1` });
  assert.equal((await proxied.request('/api/auth/login', { ...input, forwarded: '203.0.113.3, 198.51.100.1' })).status, 429);
  assert.equal((await proxied.request('/api/auth/login', { ...input, forwarded: '198.51.100.2' })).status, 400);
});
