import staticFiles from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

type Visitor = { expires: number; turns: number; sessions: number };
export function registerWeb(app: FastifyInstance) {
  const root = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
  const visitors = new Map<string, Visitor>();
  const available = existsSync(root + '/index.html');
  const secure = process.env.NODE_ENV === 'production';
  const cookieName = secure ? '__Host-tutor' : 'tutor';
  let totalTurns = 0;
  let windowStart = Date.now();
  const cookieId = (request: FastifyRequest) => request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const prune = () => {
    for (const [id, visitor] of visitors) if (visitor.expires < Date.now()) visitors.delete(id);
    if (Date.now() - windowStart > 3_600_000) { totalTurns = 0; windowStart = Date.now(); }
  };
  if (available) {
    app.register(staticFiles, { root, index: false, cacheControl: true, maxAge: '1h', dotfiles: 'deny' });
    app.get('/', async (request, reply) => {
      prune();
      const current = cookieId(request);
      if (!current || !visitors.has(current)) {
        if (visitors.size >= 200) return reply.code(503).send('O tutor está ocupado. Tente novamente em alguns minutos.');
        const id = randomUUID();
        visitors.set(id, { expires: Date.now() + 3_600_000, turns: 0, sessions: 0 });
        reply.header('Set-Cookie', `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure ? '; Secure' : ''}`);
      }
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Permissions-Policy', 'microphone=(self)');
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => { visitors.clear(); });
  return (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!available || !/^\/api\/conversation(?:\/|$)/.test(request.url.split('?')[0])) return false;
    prune();
    let visitor = visitors.get(cookieId(request) ?? '');
    const origin = process.env.PUBLIC_APP_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
    // Older open tabs cannot run the new client-side renewal code. Let the
    // official page renew the same public guest access when starting practice.
    const starting = request.method === 'POST' && request.url.split('?')[0] === '/api/conversation';
    if (!visitor && starting && origin && request.headers.origin === origin) {
      if (visitors.size >= 200) {
        reply.code(503).send({ message: 'O tutor está ocupado. Tente novamente em alguns minutos.' });
        return true;
      }
      const id = randomUUID();
      visitor = { expires: Date.now() + 3_600_000, turns: 0, sessions: 0 };
      visitors.set(id, visitor);
      reply.header('Set-Cookie', `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure ? '; Secure' : ''}`);
    }
    if (!visitor) return false;
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (!origin || request.headers.origin !== origin) {
        reply.code(403).send({ message: 'Abra a conversa pelo domínio oficial do tutor.' });
        return true;
      }
      if (request.method === 'POST' && request.url.split('?')[0] === '/api/conversation') {
        if (visitor.sessions >= 10) {
          reply.code(429).send({ message: 'Muitas sessões iniciadas nesta hora. Tente novamente mais tarde.' });
          return true;
        }
        visitor.sessions++;
      }
      if (request.method === 'POST' && request.url.endsWith('/turn')) {
        if (visitor.turns >= 60 || totalTurns >= 300) {
          reply.header('Retry-After', '3600').code(429).send({ message: 'O limite de prática desta hora foi atingido. Volte mais tarde.' });
          return true;
        }
        visitor.turns++;
        totalTurns++;
      }
    }
    return true;
  };
}
