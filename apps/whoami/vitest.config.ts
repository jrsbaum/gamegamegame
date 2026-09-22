import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
