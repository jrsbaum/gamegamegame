import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hookEvents, hookHandler, sanitizeEvent, validateHookConfig } from '../server/connector/logic.mjs';

test('CONN-10: connector allowlists provider lifecycle fields and drops private content', () => {
  const codex = sanitizeEvent('codex', {
    method: 'item/started',
    params: { threadId: 'thread', turnId: 'turn', prompt: 'segredo', item: { id: 'tool', type: 'commandExecution', command: 'cat segredo', output: 'resposta' } },
  });
  assert.deepEqual(codex, { method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item: { id: 'tool', type: 'commandExecution' } } });
  assert.equal(JSON.stringify(codex).includes('segredo'), false);
  const claude = sanitizeEvent('claude', { session_id: 'session', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tool', tool_input: { command: 'secret' } });
  assert.deepEqual(claude, { session_id: 'session', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tool' });
  const codexHook = sanitizeEvent('codex', { session_id: 'session', hook_event_name: 'PreToolUse', turn_id: 'turn', tool_name: 'Bash', tool_use_id: 'tool', tool_input: { command: 'secret' } });
  assert.deepEqual(codexHook, { session_id: 'session', turn_id: 'turn', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tool' });
});

test('CONN-03/EDGE-03: connector preserves bounded parent and spawn metadata across sessions', () => {
  const parent = sanitizeEvent('codex', {
    session_id: 'child-session', parent_session_id: 'parent-session', hook_event_name: 'SessionStart',
    agent_id: 'agent-1', agent_type: 'worker', prompt: 'senha: hunter2', token: 'do-not-forward',
  });
  assert.deepEqual(parent, {
    session_id: 'child-session', hook_event_name: 'SessionStart',
    parent_session_id: 'parent-session', agent_id: 'agent-1', agent_type: 'worker',
    agent_spawn: { parent_session_id: 'parent-session', agent_id: 'agent-1', agent_type: 'worker' },
  });
  assert.equal(JSON.stringify(parent).includes('hunter2'), false);
  assert.equal(JSON.stringify(parent).includes('do-not-forward'), false);

  const child = sanitizeEvent('codex', {
    method: 'turn/started', params: {
      threadId: 'second-session', parentThreadId: 'parent-session',
      agent: { id: 'agent-2', type: 'worker', session_id: 'second-session' },
      turn: { id: 'turn-2', status: 'inProgress' }, prompt: 'private transcript',
    },
  });
  assert.equal(child.params.threadId, 'second-session');
  assert.equal(child.parent_session_id, 'parent-session');
  assert.equal(child.agent_id, 'agent-2');
  assert.equal(child.agent_type, 'worker');
  assert.equal(child.spawned_session_id, 'second-session');
  assert.deepEqual(child.agent_spawn, { parent_session_id: 'parent-session', session_id: 'second-session', agent_id: 'agent-2', agent_type: 'worker' });
  assert.equal(JSON.stringify(child).includes('private transcript'), false);

  const claude = sanitizeEvent('claude', {
    session_id: 'parent-session', hook_event_name: 'SubagentStart',
    agent_id: 'agent-3', agent_type: 'explorer', child_session_id: 'third-session',
    parentSessionId: 'parent-session', api_key: 'secret-value',
  });
  assert.equal(claude.spawned_session_id, 'third-session');
  assert.equal(claude.agent_id, 'agent-3');
  assert.equal(claude.agent_type, 'explorer');
  assert.equal(JSON.stringify(claude).includes('secret-value'), false);
  assert.equal(hookEvents('claude').includes('SubagentStart'), true);
});

test('BUBBLE-01: task hooks send a bounded title and description summary only', () => {
  const event = sanitizeEvent('codex', {
    session_id: 'session', hook_event_name: 'UserPromptSubmit',
    prompt: '\n# Organizar a vila\n\nLeia os arquivos e ajuste o painel sem enviar dados privados.',
    transcript_path: 'C:\\private\\transcript.jsonl', token: 'secret-token',
  });
  assert.deepEqual(event, {
    session_id: 'session', hook_event_name: 'UserPromptSubmit',
    title: 'Organizar a vila',
    description: 'Organizar a vila Leia os arquivos e ajuste o painel sem enviar dados privados.',
  });
  assert.equal(JSON.stringify(event).includes('transcript'), false);
  assert.equal(JSON.stringify(event).includes('secret-token'), false);
  const long = sanitizeEvent('claude', { session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: `linha ${'x'.repeat(400)}` });
  assert.equal(long.title.length, 120);
  assert.equal(long.description.length, 280);
  assert.equal(sanitizeEvent('codex', { session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: '   ' }).title, undefined);
  const redacted = sanitizeEvent('codex', { session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: '# Revisar C:\\Users\\Jrs\\app --api-key sk-12345678901234567890 token=abc123\nArquivo /srv/private/key.pem' });
  assert.equal(redacted.title, 'Revisar [caminho] [argumento] token: [redigido]');
  assert.equal(redacted.description.includes('C:\\Users'), false);
  assert.equal(redacted.description.includes('sk-123456'), false);
  assert.equal(redacted.description.includes('abc123'), false);
  assert.equal(redacted.description.includes('/srv/private'), false);
  const headers = sanitizeEvent('codex', { session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: '# Ajustar /secret.pem Authorization: Bearer FICTITIOUS-ACCESS-TOKEN senha="FICTITIOUS SECRET VALUE"' });
  assert.equal(headers.description.includes('/secret.pem'), false);
  assert.equal(headers.description.includes('FICTITIOUS-ACCESS-TOKEN'), false);
  assert.equal(headers.description.includes('SECRET VALUE'), false);
  const password = sanitizeEvent('codex', { session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: '# Configurar acesso com senha hunter2' });
  assert.equal(password.description.includes('hunter2'), false);
  const fenced = sanitizeEvent('codex', { session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: '# Tarefa\n```\ncat /srv/private/key.pem\n```' });
  assert.equal(fenced.description, 'Tarefa');
});

test('CONN-05/11: hook definitions identify the robot and keep session end synchronous', () => {
  assert.deepEqual(hookEvents('codex'), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd']);
  const background = hookHandler('codex', 'PostToolUse', 'node collector.mjs', 'robot-1');
  assert.equal(background.hooks[0].async, true);
  assert.equal(background.hooks[0].type, 'command');
  assert.match(background.hooks[0].statusMessage, /gamegamegame-agent-village:robot-1/);
  assert.equal('async' in hookHandler('codex', 'SessionEnd', 'node collector.mjs', 'robot-1').hooks[0], false);
});

test('CONN-05: malformed hook containers are rejected before merge', () => {
  assert.throws(() => validateHookConfig({ hooks: [] }, 'hooks.json'), /Hooks inválidos: hooks\.json/);
  assert.deepEqual(validateHookConfig({}, 'hooks.json'), {});
});

test('CONN-12: concurrent collector processes allocate strictly increasing sequences', async t => {
  const received = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body).sequence);
    res.writeHead(200).end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const dir = await mkdtemp(join(tmpdir(), 'agent-village-connector-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}`, token: 'a'.repeat(64), provider: 'codex', sequence: 0 }));
  const collector = fileURLToPath(new URL('../server/connector/collector.mjs', import.meta.url));
  const event = JSON.stringify({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
  await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [collector, '--config', configPath]);
    child.on('close', code => code === 0 ? resolve() : reject(Error(`collector exited ${code}`)));
    child.stdin.end(event);
  })));
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(saved.sequence, 8);
  assert.deepEqual([...new Set(received)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('CONN-03: transient event failure retries the same connection sequence', async t => {
  const received = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body).sequence);
    res.writeHead(received.length === 1 ? 503 : 200).end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const dir = await mkdtemp(join(tmpdir(), 'agent-village-connector-retry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}`, token: 'a'.repeat(64), provider: 'codex', sequence: 0 }));
  const collector = fileURLToPath(new URL('../server/connector/collector.mjs', import.meta.url));
  const child = spawn(process.execPath, [collector, '--config', configPath]);
  child.stdin.end(JSON.stringify({ method: 'turn/started', params: { threadId: 'session-b', turn: { id: 'turn-b' } } }));
  const exitCode = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  assert.equal(exitCode, 0);
  assert.deepEqual(received, [1, 1]);
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).sequence, 1);
});

test('CONN-13: collector swallows network failure and exits cleanly', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-village-connector-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify({ endpoint: 'http://127.0.0.1:1', token: 'a'.repeat(64), provider: 'codex', sequence: 0 }));
  const collector = fileURLToPath(new URL('../server/connector/collector.mjs', import.meta.url));
  const child = spawn(process.execPath, [collector, '--config', configPath]);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } }));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });
  assert.equal(exitCode, 0);
  assert.match(stderr, /sinal não enviado/);
});
