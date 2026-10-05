import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5176, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3340', '/healthz': 'http://127.0.0.1:3340' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
