import Fastify from 'fastify';
import { registerConversation } from './conversation.js';
import { timingSafeEqual } from 'node:crypto';
import { registerWeb } from './web.js';

export function buildApp(requestProvider: typeof fetch = fetch) {
  const app = Fastify({ logger: true });
  const browserAccess = registerWeb(app);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const expected = process.env.BACKEND_ACCESS_TOKEN;
    if (browserAccess(request, reply)) return;
    if (!expected && process.env.NODE_ENV !== 'production') return;
    const supplied = request.headers['x-backend-token'];
    if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return reply.code(401).send({ message: 'Acesso ao backend não autorizado.' });
    }
  });
  app.get('/health', async () => ({ status: 'ok' }));
  const types = ['audio/webm', 'audio/ogg', 'audio/mp4'];
  app.addContentTypeParser(types, { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  app.post('/api/recordings', { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (!type || !types.includes(type)) return reply.code(415).send({ message: 'Formato de áudio não suportado.' });
    const audio = request.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) return reply.code(400).send({ message: 'A gravação está vazia.' });
    const valid = type === 'audio/webm' ? audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : type === 'audio/ogg' ? audio.subarray(0, 4).toString() === 'OggS'
      : audio.length >= 12 && audio.subarray(4, 8).toString() === 'ftyp';
    if (!valid) return reply.code(400).send({ message: 'O arquivo não corresponde ao formato de áudio informado.' });
    // Signature validation only; decoding and pronunciation assessment come later.
    return { status: 'received', bytes: audio.length, mimeType: type, assessment: null };
  });
  registerConversation(app, requestProvider);
  return app;
}
