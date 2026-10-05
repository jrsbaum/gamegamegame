const clean = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;

const redactSensitive = value => value
  .replace(/\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/g, '[segredo]')
  .replace(/\b(api[_ -]?key|api[_ -]?token|token|secret|password|senha|passphrase|credencial)\b\s*(?:[:=]|é)\s*(?:"[^"]*"|'[^']*'|`[^`]*`|\S+(?:\s+\S+)?)/gi, (_, label) => `${label}: [redigido]`)
  .replace(/\b(senha|password|passphrase|secret)\b\s+(?:"[^"]*"|'[^']*'|`[^`]*`|[A-Za-z0-9._-]+(?:\s+[A-Za-z0-9._-]+)?)/gi, (_, label) => `${label}: [redigido]`)
  .replace(/\b(authorization|bearer)\b\s*:\s*(?:bearer\s+)?(?:"[^"]*"|'[^']*'|`[^`]*`|\S+(?:\s+\S+)?)/gi, (_, label) => `${label}: [redigido]`)
  .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|etc|opt|workspace|src|dist|app|srv|mnt|private)\b)[^\s,)]+/gi, '[caminho]')
  .replace(/\/(?:[A-Za-z0-9._~:-]+\/)*[A-Za-z0-9._~:-]+/g, '[caminho]')
  .replace(/(^|\s)--?[A-Za-z][\w-]*(?:=|\s+)(?:"[^"]*"|'[^']*'|\S+)/g, '$1[argumento]');

const normalizePrompt = value => {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return [];
  const lines = []; let fenced = false;
  for (const rawLine of value.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim().replace(/\s+/g, ' ');
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line || /^(?:assistant|resposta|output)\s*:/i.test(line)) continue;
    lines.push(redactSensitive(line));
  }
  return lines;
};

export function summarizeTask(prompt) {
  const lines = normalizePrompt(prompt);
  if (!lines.length) return {};
  const firstLine = lines[0].replace(/^#{1,6}\s+/, '').trim();
  const title = firstLine.slice(0, 120);
  const description = [firstLine, ...lines.slice(1)].filter(Boolean).join(' ').slice(0, 280);
  return {title: title || undefined, description: description || undefined};
}

const addTaskSummary = (event, prompt) => Object.assign(event, summarizeTask(prompt));

// Harnesses do not agree on the names used for parent/child metadata. Keep a
// small, explicit allowlist here so a collector can carry the relationship
// without forwarding the provider payload (which may contain prompts,
// transcripts or credentials).
const firstClean = (sources, keys) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of keys) {
      const value = clean(source[key]);
      if (value) return value;
    }
  }
  return undefined;
};

const spawnObject = (sources) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of ['agent_spawn', 'agentSpawn', 'spawn', 'subagent', 'agent']) {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
  }
  return undefined;
};

const addSessionMetadata = (event, ...sources) => {
  const nestedSpawn = spawnObject(sources);
  const allSources = nestedSpawn ? [...sources, nestedSpawn] : sources;
  const parentSessionId = firstClean(allSources, ['parent_session_id', 'parentSessionId', 'parent_thread_id', 'parentThreadId']);
  const spawnedSessionId = firstClean(sources, ['spawned_session_id', 'spawnedSessionId', 'child_session_id', 'childSessionId', 'agent_session_id', 'agentSessionId'])
    || (nestedSpawn && firstClean([nestedSpawn], ['session_id', 'sessionId']));
  const agentId = firstClean(allSources, ['agent_id', 'agentId', 'subagent_id', 'subagentId', 'child_agent_id', 'childAgentId', 'id']);
  const agentType = firstClean(allSources, ['agent_type', 'agentType', 'subagent_type', 'subagentType', 'type']);
  if (parentSessionId) event.parent_session_id = parentSessionId;
  if (spawnedSessionId) event.spawned_session_id = spawnedSessionId;
  if (agentId) event.agent_id = agentId;
  if (agentType) event.agent_type = agentType;
  if (parentSessionId || spawnedSessionId || agentId || agentType) {
    event.agent_spawn = Object.fromEntries([
      ['parent_session_id', parentSessionId],
      ['session_id', spawnedSessionId],
      ['agent_id', agentId],
      ['agent_type', agentType],
    ].filter(([, value]) => value));
  }
  return event;
};

export function sanitizeEvent(provider, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (provider === 'codex') {
    if (raw.hook_event_name) {
      const event = { session_id: clean(raw.session_id), turn_id: clean(raw.turn_id), hook_event_name: clean(raw.hook_event_name) };
      if (!event.turn_id) delete event.turn_id;
      for (const key of ['tool_name', 'tool_use_id', 'stop_reason']) if (clean(raw[key])) event[key] = raw[key];
      addSessionMetadata(event, raw);
      if (event.hook_event_name === 'UserPromptSubmit') addTaskSummary(event, raw.prompt);
      return event.session_id && event.hook_event_name ? event : null;
    }
    const params = raw.params && typeof raw.params === 'object' ? raw.params : {};
    const item = params.item && typeof params.item === 'object' ? params.item : {};
    const status = params.status && typeof params.status === 'object' ? params.status : {};
    const turn = params.turn && typeof params.turn === 'object' ? params.turn : {};
    const event = { method: clean(raw.method), params: {} };
    for (const [key, value] of [['threadId', params.threadId], ['turnId', params.turnId]]) if (clean(value)) event.params[key] = value;
    addSessionMetadata(event, raw, params);
    if (clean(turn.id) || clean(turn.status)) event.params.turn = Object.fromEntries(Object.entries({ id: turn.id, status: turn.status }).filter(([, value]) => clean(value)));
    if (clean(status.type) || Array.isArray(status.activeFlags)) event.params.status = { type: clean(status.type), activeFlags: Array.isArray(status.activeFlags) ? status.activeFlags.filter(flag => clean(flag)).slice(0, 8) : undefined };
    if (clean(item.id) || clean(item.type)) event.params.item = Object.fromEntries(Object.entries({ id: item.id, type: item.type }).filter(([, value]) => clean(value)));
    return event.method && Object.keys(event.params).length ? event : null;
  }
  if (provider === 'claude') {
    const event = { session_id: clean(raw.session_id), hook_event_name: clean(raw.hook_event_name) };
    for (const key of ['tool_name', 'tool_use_id', 'stop_reason']) if (clean(raw[key])) event[key] = raw[key];
    addSessionMetadata(event, raw);
    if (event.hook_event_name === 'UserPromptSubmit') addTaskSummary(event, raw.prompt);
    return event.session_id && event.hook_event_name ? event : null;
  }
  if (provider === 'cursor') {
    const event = { conversation_id: clean(raw.conversation_id), generation_id: clean(raw.generation_id), hook_event_name: clean(raw.hook_event_name) };
    for (const key of ['tool_name', 'tool_use_id', 'status']) if (clean(raw[key])) event[key] = raw[key];
    addSessionMetadata(event, raw);
    if (event.hook_event_name === 'beforeSubmitPrompt') addTaskSummary(event, raw.prompt);
    return event.conversation_id && event.hook_event_name ? event : null;
  }
  return null;
}

export function hookEvents(provider) {
  if (provider === 'codex') return ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd'];
  if (provider === 'claude') return ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd'];
  if (provider === 'cursor') return ['sessionStart', 'beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'stop', 'sessionEnd'];
  return [];
}

export function validateHookConfig(config, path = 'hooks') {
  if (config && Object.prototype.hasOwnProperty.call(config, 'hooks') && (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks))) {
    throw Error(`Hooks inválidos: ${path}`);
  }
  return config;
}

export function hookHandler(provider, event, command, robotId) {
  return {
    hooks: [{
      type: 'command', command, timeout: 3, statusMessage: `Enviando sinal para a Vila · gamegamegame-agent-village:${robotId}`,
      ...(provider === 'codex' && event !== 'SessionEnd' ? { async: true } : {}),
    }],
  };
}
