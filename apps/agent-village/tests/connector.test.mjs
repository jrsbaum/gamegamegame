import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hookEvents, hookHandler, sanitizeEvent } from '../server/connector/logic.mjs';

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

test('CONN-05/11: hook definitions identify the robot and keep session end synchronous', () => {
  assert.deepEqual(hookEvents('codex'), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd']);
  const background = hookHandler('codex', 'PostToolUse', 'node collector.mjs', 'robot-1');
  assert.equal(background.hooks[0].async, true);
  assert.equal(background.hooks[0].type, 'command');
  assert.equal('async' in hookHandler('codex', 'SessionEnd', 'node collector.mjs', 'robot-1').hooks[0], false);
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
