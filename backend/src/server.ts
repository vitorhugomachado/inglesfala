import { buildApp } from './app.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const environmentFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);

const app = buildApp();
if (process.env.NODE_ENV === 'production' && (!process.env.GROQ_API_KEY?.trim() || !process.env.BACKEND_ACCESS_TOKEN?.trim())) {
  throw new Error('GROQ_API_KEY e BACKEND_ACCESS_TOKEN são obrigatórios em produção.');
}
const port = Number(process.env.PORT || 3001);
try {
  await app.listen({ port, host: process.env.HOST || '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
}
