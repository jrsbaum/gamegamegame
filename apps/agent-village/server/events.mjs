// Pure adapter: raw provider events -> robot state -> public, allowlisted view.
// An authenticated connector must resolve member/session ownership before calling it.
export const statusLabels = {
  idle: 'Descansando', working: 'Trabalhando', reading: 'Lendo', tool: 'Usando ferramenta',
  waiting: 'Aguardando você', completed: 'Concluído', interrupted: 'Interrompido',
  error: 'Precisa de ajuda', offline: 'Desconectado'
};

const cleanSummary = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;

export function normalizeEvent(provider, raw) {
  if (!raw || typeof raw !== 'object') return null;
  let sessionId, parentSessionId, runId, action, toolId, name, title, description;
  if (provider === 'codex') {
    if (raw.hook_event_name) {
      sessionId = raw.session_id;
      parentSessionId = raw.parent_session_id || raw.parentSessionId;
      runId = raw.turn_id;
      name = raw.hook_event_name;
      title = cleanSummary(raw.title, 120);
      description = cleanSummary(raw.description, 280);
      if (name === 'SessionStart' || name === 'UserPromptSubmit') action = 'start';
      if (name === 'PreToolUse') { action = /^(Read|Search|Grep|Glob)$/i.test(raw.tool_name || '') ? 'readStart' : 'toolStart'; toolId = raw.tool_use_id; }
      if (name === 'PostToolUse') { action = 'toolEnd'; toolId = raw.tool_use_id; }
      if (name === 'PermissionRequest') action = 'wait';
      if (name === 'Stop') action = raw.stop_reason === 'error' ? 'error' : 'finish';
      if (name === 'SessionEnd') action = 'disconnect';
    }
    const p = raw.params || {};
    if (!raw.hook_event_name) {
      sessionId = p.threadId;
      parentSessionId = p.parentSessionId || p.parent_session_id;
      runId = p.turnId || p.turn?.id;
      name = raw.method;
      if (name === 'turn/started') action = 'start';
      if (name === 'turn/completed') action = ({completed:'finish',interrupted:'interrupt',failed:'error'})[p.turn?.status];
      if (name === 'thread/status/changed' && p.status?.type === 'active') {
        action = Array.isArray(p.status.activeFlags) && p.status.activeFlags.some(f => f === 'waitingOnApproval' || f === 'waitingOnUserInput') ? 'wait' : 'resume';
      }
    }
    if (['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch'].includes(p.item?.type)) {
      if (name === 'item/started') action = p.item.type === 'webSearch' ? 'readStart' : 'toolStart';
      if (name === 'item/completed') action = 'toolEnd';
      toolId = p.item.id;
    }
  } else if (provider === 'cursor') {
    sessionId = raw.conversation_id;
    parentSessionId = raw.parent_session_id || raw.parentSessionId;
    runId = raw.generation_id;
    name = raw.hook_event_name;
    title = cleanSummary(raw.title, 120);
    description = cleanSummary(raw.description, 280);
    if (name === 'sessionStart' || name === 'beforeSubmitPrompt') action = 'start';
    if (name === 'preToolUse') { action = /^(Read|Search|Grep|Glob)$/i.test(raw.tool_name || '') ? 'readStart' : 'toolStart'; toolId = raw.tool_use_id; }
    if (name === 'postToolUse' || name === 'postToolUseFailure') { action = 'toolEnd'; toolId = raw.tool_use_id; }
    if (name === 'stop') action = ({completed:'finish',aborted:'interrupt',error:'error'})[raw.status];
    if (name === 'sessionEnd') action = 'disconnect';
  } else if (provider === 'claude') {
    sessionId = raw.session_id;
    parentSessionId = raw.parent_session_id || raw.parentSessionId;
    name = raw.hook_event_name;
    title = cleanSummary(raw.title, 120);
    description = cleanSummary(raw.description, 280);
    if (name === 'SessionStart' || name === 'UserPromptSubmit' || name === 'SubagentStart') action = 'start';
    if (name === 'PreToolUse') { action = /^(Read|Search|Grep|Glob)$/i.test(raw.tool_name || '') ? 'readStart' : 'toolStart'; toolId = raw.tool_use_id; }
    if (name === 'PostToolUse' || name === 'PostToolUseFailure') { action = 'toolEnd'; toolId = raw.tool_use_id; }
    if (name === 'PermissionRequest') action = 'wait';
    if (name === 'Stop') action = 'finish';
    if (name === 'StopFailure') action = 'error';
    if (name === 'SessionEnd') action = 'disconnect';
  }
  if (!action || !validId(sessionId) || (parentSessionId !== undefined && !validId(parentSessionId)) || (runId !== undefined && !validId(runId)) || (toolId !== undefined && !validId(toolId))) return null;
  if (['toolStart', 'readStart', 'toolEnd'].includes(action) && !toolId) return null;
  // Retain only the bounded, pre-redacted task summary; never retain full prompts, arguments, replies or credentials.
  return {provider,sessionId,parentSessionId,runId,action,toolId,name,title,description};
}

export function createRobots(definitions) {
  return definitions.map(d => ({...d,status:'idle',runId:null,tools:[],lastSignalAt:null}));
}

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
const toolStatus = robot => robot.tools.some(tool => !tool.reading) ? 'tool' : robot.tools.length ? 'reading' : 'working';

export function applyEvent(robots, event) {
  if (!event) return null;
  const robot = robots.find(r => r.provider === event.provider && r.sessionId === event.sessionId);
  if (!robot) return null; // Only sessions registered by their connector are accepted.
  if (event.runId && robot.runId && event.runId !== robot.runId && event.action !== 'start') return null;
  if (event.action === 'start') {
    if (['completed', 'interrupted', 'error', 'offline'].includes(robot.status)) return null;
    robot.runId = event.runId || null;
    robot.tools = [];
    robot.status = 'working';
    if (event.name === 'UserPromptSubmit' || event.name === 'beforeSubmitPrompt') {
      robot.title = event.title || undefined;
      robot.description = event.description || undefined;
    }
  } else if (event.action === 'toolStart' || event.action === 'readStart') {
    if (['completed','interrupted','error','offline'].includes(robot.status)) return null;
    if (event.toolId && !robot.tools.some(tool => tool.id === event.toolId)) robot.tools.push({id:event.toolId,reading:event.action === 'readStart'});
    robot.status = toolStatus(robot);
  } else if (event.action === 'toolEnd') {
    if (['completed','interrupted','error','offline'].includes(robot.status)) return null;
    robot.tools = robot.tools.filter(t => t.id !== event.toolId);
    robot.status = toolStatus(robot);
  } else if (event.action === 'wait') {
    if (!['working','reading','tool','waiting'].includes(robot.status)) return null;
    robot.status = 'waiting';
  } else if (event.action === 'resume') {
    if (!['working','reading','tool','waiting'].includes(robot.status)) return null;
    robot.status = toolStatus(robot);
  } else {
    const terminal = {finish:'completed',interrupt:'interrupted',error:'error',disconnect:'offline'};
    if (!terminal[event.action]) return null;
    robot.status = terminal[event.action];
    robot.tools = [];
  }
  return robot;
}

export function publicRobot(robot) {
  // This must run on the server before broadcasting in the shared product.
  const out = {id:robot.id,ownerId:robot.ownerId,label:robot.label,provider:robot.provider,status:robot.status,simulated:Boolean(robot.simulated),lastSignalAt:robot.lastSignalAt ?? null};
  if (['title','description'].includes(robot.privacy) && robot.title) out.title = String(robot.title).slice(0,120);
  if (robot.privacy === 'description' && robot.description) out.description = String(robot.description).slice(0,280);
  return out;
}

// All members, task titles, descriptions, IDs and events below are fictional.
export const demoRobots = [
  {id:'jrs-codex-1',member:'Jrs',provider:'codex',sessionId:'demo-codex-a',label:'Codex 1',privacy:'none',title:'Construir a vila',description:'Criando os cenários e as mesas do escritório.'},
  {id:'jrs-codex-2',member:'Jrs',provider:'codex',sessionId:'demo-codex-b',label:'Codex 2',privacy:'none',title:'Preparar os convites',description:'Desenhando a entrada dos novos moradores.'},
  {id:'bia-cursor-1',member:'Renatin',provider:'cursor',sessionId:'demo-cursor-a',label:'Cursor',privacy:'title',title:'Criar um portfólio',description:'Ajustando a página dos projetos pessoais.'},
  {id:'rafa-claude-1',member:'Julin',provider:'claude',sessionId:'demo-claude-a',label:'Claude 1',privacy:'description',title:'Planejar uma viagem',description:'Comparando roteiros para um fim de semana.'},
  {id:'rafa-claude-2',member:'Julin',provider:'claude',sessionId:'demo-claude-b',label:'Claude 2',privacy:'none',title:'Escrever uma proposta',description:'Organizando as entregas de um projeto.'}
];
const cx = (t,s,method,params={}) => ({at:t,provider:'codex',event:{method,params:{threadId:s,...params}}});
const cr = (t,name,extra={}) => ({at:t,provider:'cursor',event:{hook_event_name:name,conversation_id:'demo-cursor-a',generation_id:'cursor-turn-1',...extra}});
const cl = (t,s,name,extra={}) => ({at:t,provider:'claude',event:{hook_event_name:name,session_id:s,...extra}});
export const demoEvents = [
  cx(0,'demo-codex-a','turn/started',{turn:{id:'turn-a',status:'inProgress',items:[]}}),
  cr(900,'beforeSubmitPrompt'),
  cl(1600,'demo-claude-a','UserPromptSubmit'),
  cx(2500,'demo-codex-b','turn/started',{turn:{id:'turn-b',status:'inProgress',items:[]}}),
  cx(3400,'demo-codex-a','item/started',{turnId:'turn-a',item:{id:'cmd-1',type:'commandExecution',status:'inProgress'}}),
  cl(4300,'demo-claude-b','UserPromptSubmit'),
  cr(5200,'preToolUse',{tool_use_id:'cursor-tool-1',tool_name:'Write'}),
  cx(6100,'demo-codex-a','item/completed',{turnId:'turn-a',item:{id:'cmd-1',type:'commandExecution',status:'completed'}}),
  cx(7000,'demo-codex-a','thread/status/changed',{status:{type:'active',activeFlags:['waitingOnApproval']}}),
  cl(7900,'demo-claude-a','PreToolUse',{tool_use_id:'claude-tool-1',tool_name:'Read'}),
  cr(8800,'postToolUse',{tool_use_id:'cursor-tool-1'}),
  cx(9700,'demo-codex-a','thread/status/changed',{status:{type:'active',activeFlags:[]}}),
  cl(10600,'demo-claude-a','PostToolUse',{tool_use_id:'claude-tool-1'}),
  cr(11500,'stop',{status:'completed'}),
  cl(12400,'demo-claude-b','PreToolUse',{tool_use_id:'claude-tool-2',tool_name:'Write'}),
  cx(13300,'demo-codex-b','turn/completed',{turn:{id:'turn-b',status:'completed'}}),
  cl(14200,'demo-claude-a','Stop'),
  cx(15100,'demo-codex-a','turn/completed',{turn:{id:'turn-a',status:'completed'}}),
  cl(16000,'demo-claude-b','PostToolUse',{tool_use_id:'claude-tool-2'}),
  cl(16900,'demo-claude-b','Stop')
];
