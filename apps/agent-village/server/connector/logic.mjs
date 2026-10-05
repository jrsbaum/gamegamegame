const clean = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;

export function sanitizeEvent(provider, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (provider === 'codex') {
    if (raw.hook_event_name) {
      const event = { session_id: clean(raw.session_id), turn_id: clean(raw.turn_id), hook_event_name: clean(raw.hook_event_name) };
      for (const key of ['tool_name', 'tool_use_id', 'stop_reason']) if (clean(raw[key])) event[key] = raw[key];
      return event.session_id && event.hook_event_name ? event : null;
    }
    const params = raw.params && typeof raw.params === 'object' ? raw.params : {};
    const item = params.item && typeof params.item === 'object' ? params.item : {};
    const status = params.status && typeof params.status === 'object' ? params.status : {};
    const turn = params.turn && typeof params.turn === 'object' ? params.turn : {};
    const event = { method: clean(raw.method), params: {} };
    for (const [key, value] of [['threadId', params.threadId], ['turnId', params.turnId]]) if (clean(value)) event.params[key] = value;
    if (clean(turn.id) || clean(turn.status)) event.params.turn = Object.fromEntries(Object.entries({ id: turn.id, status: turn.status }).filter(([, value]) => clean(value)));
    if (clean(status.type) || Array.isArray(status.activeFlags)) event.params.status = { type: clean(status.type), activeFlags: Array.isArray(status.activeFlags) ? status.activeFlags.filter(flag => clean(flag)).slice(0, 8) : undefined };
    if (clean(item.id) || clean(item.type)) event.params.item = Object.fromEntries(Object.entries({ id: item.id, type: item.type }).filter(([, value]) => clean(value)));
    return event.method && Object.keys(event.params).length ? event : null;
  }
  if (provider === 'claude') {
    const event = { session_id: clean(raw.session_id), hook_event_name: clean(raw.hook_event_name) };
    for (const key of ['tool_name', 'tool_use_id', 'stop_reason']) if (clean(raw[key])) event[key] = raw[key];
    return event.session_id && event.hook_event_name ? event : null;
  }
  if (provider === 'cursor') {
    const event = { conversation_id: clean(raw.conversation_id), generation_id: clean(raw.generation_id), hook_event_name: clean(raw.hook_event_name) };
    for (const key of ['tool_name', 'tool_use_id', 'status']) if (clean(raw[key])) event[key] = raw[key];
    return event.conversation_id && event.hook_event_name ? event : null;
  }
  return null;
}

export function hookEvents(provider) {
  if (provider === 'codex') return ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd'];
  if (provider === 'claude') return ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd'];
  return [];
}

export function hookHandler(provider, event, command, robotId) {
  return {
    hooks: [{
      type: 'command', command, timeout: 3, statusMessage: 'Enviando sinal para a Vila',
      ...(provider === 'codex' && event !== 'SessionEnd' ? { async: true } : {}),
    }],
  };
}
