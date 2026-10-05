import { readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { sanitizeEvent } from './logic.mjs';

const arg = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const configPath = arg('--config');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readInput() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 32768) return null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
}

async function nextSequence(config) {
  const lock = `${configPath}.lock`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const handle = await open(lock, 'wx', 0o600);
      await handle.close();
      try {
        const next = Math.max(0, Number(config.sequence) || 0) + 1;
        config.sequence = next;
        await atomicWrite(configPath, JSON.stringify(config));
        return next;
      } finally { await unlink(lock).catch(() => {}); }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await sleep(25);
    }
  }
  throw Error('sequence lock timeout');
}

async function main() {
  if (!configPath) return;
  const raw = await readInput();
  if (!raw) return;
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const event = sanitizeEvent(config.provider, raw);
    if (!event) return;
    const sequence = await nextSequence(config);
    const response = await fetch(`${config.endpoint}/api/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ sequence, event }), signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw Error('event rejected');
  } catch { process.stderr.write('Vila dos Agentes: sinal não enviado.\n'); }
}

void main();
