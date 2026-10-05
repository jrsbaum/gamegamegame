import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { hookEvents, hookHandler, validateHookConfig } from './logic.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const origin = String(args.get('--origin') || '').replace(/\/$/, '');
const code = String(args.get('--pairing-code') || '');
if (!/^(?:https:\/\/|http:\/\/127\.0\.0\.1(?::\d+)?$)/.test(origin) || !code) throw Error('Use --origin HTTPS e --pairing-code.');

const atomicWrite = async (path, value) => { const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, value, { mode: 0o600 }); await rename(temporary, path); };
const jsonFile = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw Error(`JSON inválido: ${path}`); } };
const mergeHooks = async (path, provider, command, connectionId) => {
  const config = await jsonFile(path);
  validateHookConfig(config, path);
  config.hooks = config.hooks && typeof config.hooks === 'object' && !Array.isArray(config.hooks) ? config.hooks : {};
  for (const event of hookEvents(provider)) {
    const groups = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    if (!groups.some(group => JSON.stringify(group).includes(`gamegamegame-agent-village:${connectionId}`))) groups.push(hookHandler(provider, event, command, connectionId));
    config.hooks[event] = groups;
  }
  await mkdir(dirname(path), { recursive: true });
  await atomicWrite(path, JSON.stringify(config, null, 2));
};

const response = await fetch(`${origin}/api/pairings/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(10000) });
const result = await response.json().catch(() => ({}));
if (!response.ok) throw Error(result.error || 'Código de pareamento recusado.');
const { connection, robot, token } = result;
// New pairings return a connection and no robot. Keep accepting the legacy
// response while old HML instances are being migrated.
const identity = connection || robot;
const connectionId = identity?.id || identity?.connectionId;
const provider = identity?.provider;
if (!connectionId || !provider || !token) throw Error('Resposta de pareamento inválida.');
const label = identity.label || provider;
const baseDir = join(homedir(), '.gamegamegame', 'agent-village', connectionId);
await mkdir(baseDir, { recursive: true });
const collectorPath = join(baseDir, 'collector.mjs');
const collectorResponse = await fetch(`${origin}/connector/collector.mjs`);
if (!collectorResponse.ok) throw Error('Não foi possível baixar o coletor.');
await atomicWrite(collectorPath, await collectorResponse.text());
const logicResponse = await fetch(`${origin}/connector/logic.mjs`);
if (!logicResponse.ok) throw Error('Não foi possível baixar o adaptador.');
await atomicWrite(join(baseDir, 'logic.mjs'), await logicResponse.text());
const configPath = join(baseDir, 'config.json');
await atomicWrite(configPath, JSON.stringify({ endpoint: origin, token, provider, connectionId, ...(robot?.id ? { robotId: robot.id } : {}), sequence: 0 }, null, 2));
const command = `node "${collectorPath}" --config "${configPath}"`;
const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
const hookPath = provider === 'codex' ? join(codexHome, 'hooks.json') : join(homedir(), '.claude', 'settings.json');
await mergeHooks(hookPath, provider, command, connectionId);
console.log(`Vila dos Agentes: ${label} conectado.`);
console.log(`Hooks configurados em ${hookPath}`);
console.log('Abra o agente e faça uma ação para enviar o primeiro sinal.');
