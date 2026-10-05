import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, applyEvent, publicRobot, createRobots } from '../server/events.mjs';

const definition = { id: 'local-id', ownerId: 'owner', provider: 'codex', sessionId: 'private-thread', label: 'Codex 1', privacy: 'none', title: 'Título autorizado', description: 'Descrição autorizada', connectorHash: 'secret', sequence: 0, simulated: false };
const signal = (action, extra = {}) => ({ provider: 'codex', sessionId: 'private-thread', action, name: action, runId: 'turn-1', ...extra });

test('ROBOT-04: public payload is an exact allowlist for all three privacy modes', () => {
  const robot = createRobots([definition])[0];
  const common = { id: 'local-id', ownerId: 'owner', label: 'Codex 1', provider: 'codex', status: 'idle', simulated: false, lastSignalAt: null };
  assert.deepEqual(publicRobot(robot), common);
  robot.privacy = 'title';
  assert.deepEqual(publicRobot(robot), { ...common, title: 'Título autorizado' });
  robot.privacy = 'description';
  assert.deepEqual(publicRobot(robot), { ...common, title: 'Título autorizado', description: 'Descrição autorizada' });
});

test('ROBOT-03: finishing one concurrent tool does not finish its session or another robot', () => {
  const robots = createRobots([definition, { ...definition, id: 'other', sessionId: 'second-thread' }]);
  applyEvent(robots, signal('start'));
  applyEvent(robots, signal('toolStart', { toolId: 'a' }));
  applyEvent(robots, signal('toolStart', { toolId: 'b' }));
  applyEvent(robots, signal('toolStart', { toolId: 'b' }));
  assert.equal(robots[0].tools.length, 2);
  applyEvent(robots, signal('toolEnd', { toolId: 'a' }));
  assert.equal(robots[0].status, 'tool');
  assert.equal(robots[1].status, 'idle');
  applyEvent(robots, signal('toolEnd', { toolId: 'b' }));
  assert.equal(robots[0].status, 'working');
  applyEvent(robots, signal('finish'));
  assert.equal(robots[0].status, 'completed');
  assert.equal(applyEvent(robots, signal('toolStart', { toolId: 'late' })), null);
  assert.equal(robots[0].status, 'completed');
});

test('EDGE-03: old turns and unregistered sessions are ignored', () => {
  const robots = createRobots([definition]);
  applyEvent(robots, signal('start', { runId: 'turn-2' }));
  assert.equal(applyEvent(robots, signal('finish')), null);
  assert.equal(applyEvent(robots, signal('start', { sessionId: 'unknown' })), null);
  assert.equal(robots[0].status, 'working');
});

test('ROBOT-08: reading, waiting, resume and terminal states have exact outcomes', () => {
  const robots = createRobots([definition]);
  applyEvent(robots, signal('start'));
  applyEvent(robots, signal('readStart', { toolId: 'read' }));
  assert.equal(robots[0].status, 'reading');
  applyEvent(robots, signal('wait'));
  assert.equal(robots[0].status, 'waiting');
  applyEvent(robots, signal('resume'));
  assert.equal(robots[0].status, 'reading');
  for (const [action, status] of [['interrupt', 'interrupted'], ['error', 'error'], ['disconnect', 'offline']]) {
    applyEvent(robots, signal('start'));
    applyEvent(robots, signal(action));
    assert.equal(robots[0].status, status);
    assert.deepEqual(robots[0].tools, []);
  }
});

test('ROBOT-02/08: provider adapters discard prompts and map documented events', () => {
  const cases = [
    ['codex', { method: 'turn/started', params: { threadId: 'c', turn: { id: 't' }, prompt: 'secret' } }, 'start'],
    ['codex', { method: 'item/started', params: { threadId: 'c', item: { id: 'a', type: 'webSearch', arguments: 'secret' } } }, 'readStart'],
    ['codex', { method: 'turn/completed', params: { threadId: 'c', turn: { id: 't', status: 'failed' } } }, 'error'],
    ['codex', { method: 'thread/status/changed', params: { threadId: 'c', status: { type: 'active', activeFlags: ['waitingOnApproval'] } } }, 'wait'],
    ['cursor', { conversation_id: 'c', generation_id: 't', hook_event_name: 'preToolUse', tool_use_id: 'a', tool_name: 'Read', prompt: 'secret' }, 'readStart'],
    ['cursor', { conversation_id: 'c', hook_event_name: 'stop', status: 'completed' }, 'finish'],
    ['claude', { session_id: 'c', hook_event_name: 'PermissionRequest', prompt: 'secret' }, 'wait'],
    ['claude', { session_id: 'c', hook_event_name: 'PostToolUse', tool_use_id: 'a', tool_response: 'secret' }, 'toolEnd'],
    ['claude', { session_id: 'c', hook_event_name: 'Stop' }, 'finish'],
  ];
  for (const [provider, raw, action] of cases) {
    const event = normalizeEvent(provider, raw);
    assert.equal(event.action, action);
    assert.equal(event.sessionId, 'c');
    assert.equal(JSON.stringify(event).includes('secret'), false);
  }
  assert.equal(normalizeEvent('codex', null), null);
  assert.equal(normalizeEvent('unknown', {}), null);
  assert.equal(normalizeEvent('claude', { session_id: 'x', hook_event_name: 'Unknown' }), null);
});

test('CONN-05: Codex lifecycle hooks map to the existing reducer without private fields', () => {
  const robots = createRobots([{ id: 'codex-hook', ownerId: 'owner', provider: 'codex', sessionId: 'hook-session', label: 'Codex', privacy: 'none' }]);
  assert.equal(applyEvent(robots, normalizeEvent('codex', { session_id: 'hook-session', hook_event_name: 'SessionStart' } )).status, 'working');
  assert.equal(applyEvent(robots, normalizeEvent('codex', { session_id: 'hook-session', turn_id: 'turn', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tool', tool_input: { command: 'secret' } })).status, 'tool');
  assert.equal(JSON.stringify(normalizeEvent('codex', { session_id: 'hook-session', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tool', tool_input: { command: 'secret' } })).includes('secret'), false);
  assert.equal(applyEvent(robots, normalizeEvent('codex', { session_id: 'hook-session', turn_id: 'turn', hook_event_name: 'PostToolUse', tool_use_id: 'tool' })).status, 'working');
  assert.equal(applyEvent(robots, normalizeEvent('codex', { session_id: 'hook-session', hook_event_name: 'Stop' })).status, 'completed');
});
