import test from 'node:test';
import assert from 'node:assert/strict';
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
});

test('CONN-05/11: hook definitions identify the robot and keep session end synchronous', () => {
  assert.deepEqual(hookEvents('codex'), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd']);
  const background = hookHandler('codex', 'PostToolUse', 'node collector.mjs', 'robot-1');
  assert.equal(background.hooks[0].async, true);
  assert.equal(background.hooks[0].type, 'command');
  assert.equal('async' in hookHandler('codex', 'SessionEnd', 'node collector.mjs', 'robot-1').hooks[0], false);
});
