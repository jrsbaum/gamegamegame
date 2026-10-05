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

async function nextSequence() {
  const lock = `${configPath}.lock`;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const handle = await open(lock, 'wx', 0o600);
      await handle.close();
      try {
        const current = JSON.parse(await readFile(configPath, 'utf8'));
        const next = Math.max(0, Number(current.sequence) || 0) + 1;
        current.sequence = next;
        await atomicWrite(configPath, JSON.stringify(current));
        return next;
      } finally { await unlink(lock).catch(() => {}); }
    } catch (error) {
      // Windows can briefly expose the config during an atomic rename. Treat
      // that transient read/rename failure like lock contention so one of N
      // interleaved sessions does not lose its sequence allocation.
      if (!['EEXIST', 'ENOENT', 'EPERM', 'EACCES'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
      await sleep(25);
    }
  }
  throw Error('sequence lock timeout');
}

async function sendEvent(config, payload) {
  let failure;
  // A hook can be retried by a harness. Reuse the same sequence for retries:
  // the server can safely answer accepted=false for an already seen event.
  for (const delay of [0, 75, 200]) {
    if (delay) await sleep(delay);
    try {
      const response = await fetch(`${config.endpoint}/api/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(2500),
      });
      if (response.ok) return true;
      // Authentication and validation failures are deterministic. Do not
      // retry them, but let main() report the failed signal to the harness.
      if (response.status >= 400 && response.status < 500) return false;
      failure = Error(`event rejected (${response.status})`);
    } catch (error) { failure = error; }
  }
  throw failure || Error('event rejected');
}

async function main() {
  if (!configPath) return;
  const raw = await readInput();
  if (!raw) return;
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const event = sanitizeEvent(config.provider, raw);
    if (!event) return;
    const sequence = await nextSequence();
    if (!await sendEvent(config, { sequence, event })) throw Error('event rejected');
  } catch { process.stderr.write('Vila dos Agentes: sinal não enviado.\n'); }
}

void main();
