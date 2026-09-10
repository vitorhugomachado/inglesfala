import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Server-only values: never prefix credentials with VITE_.
  const env = loadEnv(mode, process.cwd(), '');
  const api = {
    target: env.BACKEND_URL || 'http://127.0.0.1:3001',
    changeOrigin: true,
    headers: env.BACKEND_ACCESS_TOKEN ? { 'x-backend-token': env.BACKEND_ACCESS_TOKEN } : undefined,
  };
  return { server: { proxy: { '/api': api } }, preview: { proxy: { '/api': api } } };
});
