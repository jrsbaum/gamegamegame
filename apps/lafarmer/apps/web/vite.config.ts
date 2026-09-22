import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4327,
    strictPort: false
  },
  optimizeDeps: {
    exclude: ['@lafarmer/content-client']
  }
});
