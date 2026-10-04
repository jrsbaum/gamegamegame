import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('OPS-02: standalone workspace targets Node 22 and builds its own client', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '>=22 <23');
  assert.equal(pkg.scripts.build, 'npm run typecheck && vite build');
});
