import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), 'utf8')) as Record<string, unknown>;
}

describe('apps/lafarmer workspace layout', () => {
  it('keeps the independent build graph rooted at the relocated app', () => {
    const rootPackage = readJson('package.json');
    const serverPackage = readJson('apps/server/package.json');
    const webPackage = readJson('apps/web/package.json');

    expect(rootPackage.workspaces).toEqual(['apps/*', 'packages/*']);
    expect(serverPackage.dependencies).toMatchObject({ '@lafarmer/content': 'file:../../packages/content' });
    expect(webPackage.dependencies).toMatchObject({ '@lafarmer/content-client': 'file:../../packages/content-client' });
    expect(existsSync(resolve(workspaceRoot, 'apps/server/src/index.ts'))).toBe(true);
    expect(existsSync(resolve(workspaceRoot, 'apps/web/src/main.ts'))).toBe(true);
    expect(existsSync(resolve(workspaceRoot, 'infra/dokploy/docker-compose.yml'))).toBe(true);
  });
});
